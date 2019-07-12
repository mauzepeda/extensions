"use strict";
/*
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const firebase = require("firebase-admin");
const inquirer = require("inquirer");
const bigquery_1 = require("../bigquery");
const firestore_1 = require("../firestore");
const util_1 = require("../util");
const schemaFile = require("../../schema.json");
const BIGQUERY_VALID_CHARACTERS = /^[a-zA-Z0-9_]+$/;
const FIRESTORE_VALID_CHARACTERS = /^[^\/]+$/;
const validateInput = (value, name, regex) => {
    if (!value || value === "" || value.trim() === "") {
        return `Please supply a ${name}`;
    }
    if (!value.match(regex)) {
        return `The ${name} must only contain letters or spaces`;
    }
    return true;
};
const questions = [
    {
        message: "What is your Firebase project ID?",
        name: "projectId",
        type: "input",
        validate: (value) => validateInput(value, "project ID", FIRESTORE_VALID_CHARACTERS),
    },
    {
        message: "What is the path of the the collection you would like to mirror?",
        name: "collectionPath",
        type: "input",
        validate: (value) => validateInput(value, "collection path", FIRESTORE_VALID_CHARACTERS),
    },
    {
        message: "What is the ID of the BigQuery dataset that you would like to use? (The dataset will be created if it doesn't already exist)",
        name: "datasetId",
        type: "input",
        validate: (value) => validateInput(value, "dataset", BIGQUERY_VALID_CHARACTERS),
    },
    {
        message: "What is the ID of the BigQuery table that you would like to use? (The table will be created if it doesn't already exist)",
        name: "tableName",
        type: "input",
        validate: (value) => validateInput(value, "dataset", BIGQUERY_VALID_CHARACTERS),
    },
];
const run = () => __awaiter(this, void 0, void 0, function* () {
    const { collectionPath, datasetId, projectId, tableName, } = yield inquirer.prompt(questions);
    // Initialize Firebase
    firebase.initializeApp({
        credential: firebase.credential.applicationDefault(),
        databaseURL: `https://${projectId}.firebaseio.com`,
    });
    // Set project ID so it can be used in BigQuery intialization
    process.env.PROJECT_ID = projectId;
    // @ts-ignore string not assignable to enum
    const schema = schemaFile;
    const { fields, timestampField } = schema;
    // Is the collection path for a sub-collection and does the collection path
    // contain any wildcard parameters
    const idFieldNames = util_1.extractIdFieldNames(collectionPath);
    // This initialisation should be moved to `mod install` if Mods adds support
    // for executing code as part of the install process
    // Currently it runs on every cold start of the function
    yield bigquery_1.initialiseSchema(datasetId, tableName, schema, idFieldNames);
    console.log(`Mirroring data from Firestore Collection: ${collectionPath}, to BigQuery Dataset: ${datasetId}, Table: ${tableName}`);
    const importTimestamp = new Date().toISOString();
    // Load all the data for the collection
    const collectionSnapshot = yield firebase
        .firestore()
        .collection(collectionPath)
        .get();
    // Build the data rows to insert into BigQuery
    const rows = collectionSnapshot.docs.map((snapshot) => {
        const data = firestore_1.extractSnapshotData(snapshot, fields);
        // Extract the values of any `idFieldNames` specifed in the collection path
        const { id, idFieldValues } = util_1.extractIdFieldValues(snapshot, idFieldNames);
        let defaultTimestamp;
        if (snapshot.updateTime) {
            defaultTimestamp = snapshot.updateTime.toDate().toISOString();
        }
        else if (snapshot.createTime) {
            defaultTimestamp = snapshot.createTime.toDate().toISOString();
        }
        else {
            defaultTimestamp = importTimestamp;
        }
        // Extract the timestamp, or use the import timestamp as default
        const timestamp = util_1.extractTimestamp(data, defaultTimestamp, timestampField);
        // Build the data row
        return bigquery_1.buildDataRow(idFieldValues, id, "INSERT", timestamp, data);
    });
    yield bigquery_1.insertData(datasetId, tableName, rows);
    return rows.length;
});
run()
    .then((rowCount) => {
    console.log("---------------------------------------------------------");
    console.log(`Finished mirroring ${rowCount} Firestore rows to BigQuery`);
    console.log("---------------------------------------------------------");
    process.exit();
})
    .catch((error) => {
    console.error(error.message);
    console.log("---------------------------------------------------------");
    process.exit();
});