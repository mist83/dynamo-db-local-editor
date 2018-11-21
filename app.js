var app = new Vue({
    el: '#app',
    data: {
        tableDescription: null,
        tables: [],
        selectedTable: {
            schema: {
                Table: {
                    TableName: "placeholder"
                }
            },
            headers: [],
            records: [],
            filteredRecords: [],
        },
        showExpanded: false,
        overlayEverything: false,
        editOpen: false,
        errorOpen: false,
        sort: {},
        filter: "",
    },
    methods: {
        refresh: function () {
            var vue = this;
            AWS.config.credentials = new AWS.Credentials("who", "cares");
            AWS.config.endpoint = new AWS.Endpoint("http://localhost:8000");
            AWS.config.update({ region: "us-east-1" });

            new AWS.DynamoDB().listTables({}, function (err, data) {
                if (err) {
                    alert(err);
                }
                else {
                    for (var i = 0; i < data.TableNames.length; i++) {
                        vue.tables.push({
                            isActive: false,
                            schema: { Table: { TableName: data.TableNames[i] } },
                            headers: [],
                            records: [],
                            filteredRecords: [],
                        });
                    }

                    document.getElementById("app").style.display = "";
                }
            });
        },
        clickTable: function (table) {
            var vue = this;

            vue.sort = {};
            vue.filter = "";
            vue.overlayEverything = true;
            vue.selectedTable = table;

            for (var i = 0; i < vue.tables.length; i++) {
                vue.tables[i].isActive = false;
                vue.tables[i].records = [];
                vue.tables[i].selectedRecords = null;
            }

            table.isActive = true;
            vue.describeTable();
        },
        describeTable: function () {
            var vue = this;
            new AWS.DynamoDB().describeTable({
                TableName: vue.selectedTable.schema.Table.TableName
            }, function (err, data) {
                if (err === null) {
                    vue.selectedTable.schema = data;
                    vue.tableDescription = JSON.stringify(data, null, 2);
                    vue.fillTable();
                }
            });
        },
        unmarshallItem: function (item) {
            var vue = this;
            var returning = {};

            function getUnmarshalledPropertyValue(item) {
                var returning;

                // AWS property format:
                // { 'property': { 'AWS Type': value } }
                for (var prop in item) {
                    switch (prop) {
                        case 'BOOL':
                            returning = item[prop];
                            break;
                        case 'S':
                            returning = item[prop];
                            break;
                        case 'N':
                            returning = parseInt(item[prop]);
                            break;
                        case 'L':
                            returning = item[prop].map(d => {
                                return getUnmarshalledPropertyValue(d, true);
                            });
                            break;
                        case 'M':
                            returning = vue.unmarshallItem(item[prop], true);
                            break;
                        case 'NS':
                            returning = item[prop].map(d => {
                                return parseInt(d);
                            });
                            break;
                        case 'SS':
                            returning = item[prop].map(d => {
                                return d;
                            });
                            break;
                        default:
                            returning = item[prop];
                            break;
                    }
                }

                return returning;
            }

            for (var prop in item) {
                if (!prop.startsWith('aws:')) {
                    returning[prop] = getUnmarshalledPropertyValue(item[prop]);
                }
            }

            return returning;
        },
        fillTable: function () {
            var vue = this;

            new AWS.DynamoDB().scan({
                TableName: vue.selectedTable.schema.Table.TableName,
            }, function (err, data) {
                var orderedProperties = {};
                for (var i = 0; i < vue.selectedTable.schema.Table.KeySchema.length; i++) {
                    orderedProperties[vue.selectedTable.schema.Table.KeySchema[i].AttributeName] = true;
                }

                for (var i = 0; i < data.Items.length; i++) {
                    for (property in data.Items[i]) {
                        if (orderedProperties[property])
                            continue;

                        orderedProperties[property] = false;
                    }
                }

                vue.selectedTable.headers = [];
                for (property in orderedProperties)
                    vue.selectedTable.headers.push(property);

                var records = [];
                for (var i = 0; i < data.Items.length; i++) {
                    var unmarshalled = vue.unmarshallItem(data.Items[i]);

                    // Reorder the object so that the key properties show up first (at the top) during an edit
                    {
                        var reorderedUnmarshalled = {};
                        for (property in orderedProperties) {
                            if (orderedProperties[property])
                                reorderedUnmarshalled[property] = null;
                        }

                        for (property in unmarshalled) {
                            reorderedUnmarshalled[property] = unmarshalled[property];
                        }

                        unmarshalled = reorderedUnmarshalled;
                    }

                    var record = {
                        unmarshalled: unmarshalled,
                        text: JSON.stringify(unmarshalled, null, 2),
                        array: [],
                        fullArray: [],
                    };

                    for (property in orderedProperties) {
                        if (record.unmarshalled.hasOwnProperty(property)) {
                            var prettyProperty = "" + record.unmarshalled[property];
                            if (prettyProperty.startsWith("[object Object]"))
                                prettyProperty = JSON.stringify(record.unmarshalled);

                            record.fullArray.push({ isPK: orderedProperties[property], value: prettyProperty });

                            if (prettyProperty.length > 32)
                                prettyProperty = prettyProperty.substr(0, 32).trim() + "...";

                            record.array.push({ isPK: orderedProperties[property], value: prettyProperty });
                        }
                        else
                            record.array.push("");
                    }

                    records.push(record);
                }

                vue.selectedTable.records = JSON.parse(JSON.stringify(records));
                vue.selectedTable.filteredRecords = JSON.parse(JSON.stringify(records));

                vue.overlayEverything = false;
            });
        },
        sortTable(column) {
            var vue = this;

            if (!vue.sort || vue.sort.column !== column) {
                vue.sort = { column: column, direction: -1 };
            } else {
                if (vue.sort.direction === 1)
                    vue.sort = {};
                else
                    vue.sort.direction = 1
            }

            vue.runSort();
        },
        runSort: function () {

            function tryParse(val) {
                var parsed = parseInt(val);
                if (isNaN(parsed))
                    return val;

                return parsed;
            }

            var vue = this;

            if (!vue.sort.column) {
                vue.filterRecords(); // Kind of a hack - just reusing the filter logic to reset things to normal
                return;
            }

            function compare(a, b) {
                try {
                    var pa = a.unmarshalled[vue.sort.column];
                    var pb = b.unmarshalled[vue.sort.column]

                    // can't just use "if (!pa)..." because there are some "0" values
                    if (pa === null || pa === undefined)
                        return -1;
                    else if (pb === null || pb === undefined)
                        return 1;

                    // sorting is a little wonky when there are mixed types in the same column, we need to reset them so they're both comparable
                    if (typeof pa === "number" && typeof pb !== "number") {
                        pa = "" + pa;
                        pb = "" + pb;
                    }
                    if (typeof pa !== "number" && typeof pb === "number") {
                        pa = "" + pa;
                        pb = "" + pb;
                    }

                    if (pa < pb)
                        return -1;
                    else if (pa > pb)
                        return 1;
                } catch (err) {
                    console.log('error comparing: a: ' + JSON.stringify(a) + ", b: " + JSON.stringify(a));
                }

                return 0;
            }

            var sorted = vue.selectedTable.filteredRecords.sort(compare);

            if (vue.sort.direction == 1)
                sorted = sorted.reverse();

            vue.selectedTable.filteredRecords = sorted;
        },
        openItem: function (record) {
            vue = this;
            vue.selectedTable.selectedRecord = record;
            vue.modalTitle = "Edit " + vue.selectedTable.schema.Table.TableName + " record";
            vue.editOpen = true;
        },
        prettyPrint: function () {
            vue = this;
            try {
                vue.overlayEverything = true;
                vue.selectedTable.selectedRecord.text = JSON.stringify(JSON.parse(vue.selectedTable.selectedRecord.text), null, 2);
            } catch (err) {
                vue.errorDetail = err.message;
                vue.errorOpen = true;
                vue.overlayEverything = false;
            }
        },
        dismissModal: function () {
            // Reset it to the original
            this.selectedTable.selectedRecord.text = JSON.stringify(this.selectedTable.selectedRecord.unmarshalled, null, 2);
            this.editOpen = false;
        },
        saveModal: function () {
            var vue = this;

            try {
                vue.overlayEverything = true;

                cmd = {
                    TableName: vue.selectedTable.schema.Table.TableName,
                    Item: JSON.parse(vue.selectedTable.selectedRecord.text)
                };

                new AWS.DynamoDB.DocumentClient().put(cmd, function (err, awsResolve) {
                    if (err) {
                        vue.errorDetail = err;
                        vue.errorOpen = true;
                    } else {
                        vue.editOpen = false;
                        vue.fillTable();
                    }

                    vue.overlayEverything = false;
                });
            }
            catch (err) {
                vue.errorDetail = err.message;
                vue.errorOpen = true;
                vue.overlayEverything = false;
            }
        },
        filterRecords: function () {
            var vue = this;
            vue.sort = {};

            try {
                var records = [];
                for (var i = 0; i < vue.selectedTable.records.length; i++) {
                    var record = vue.selectedTable.records[i].unmarshalled;
                    var truth = eval(vue.filter);

                    if (vue.filter.trim() === "") {
                        truth = true;
                    }

                    if (truth) {
                        records.push(vue.selectedTable.records[i]);
                    }
                }

                vue.selectedTable.filteredRecords = records;
            } catch (err) {
                vue.errorDetail = err.message;
                vue.errorOpen = true;
                vue.selectedTable.filteredRecords = JSON.parse(JSON.stringify(vue.selectedTable.records));
            }
        },
        createNewRecord: function () {
            var vue = this;

            var record = {};
            var ad = vue.selectedTable.schema.Table.AttributeDefinitions;
            for (var i = 0; i < ad.length; i++) {
                if (ad[i].AttributeType === "S")
                    record[ad[i].AttributeName] = "string_value";
            }

            record["AnotherProperty"] = "some other value";

            record.text = JSON.stringify(record, null, 2);
            vue.selectedTable.selectedRecord = record;

            vue.modalTitle = "Create new " + vue.selectedTable.schema.Table.TableName + " record";
            vue.editOpen = true;
        },
        deleteTable: function () {
            var vue = this;
            alert("deleteTable: " + vue.selectedTable.schema.Table.TableName + "\n\nJustin can do this if he wants, I am SICK of HTML/CSS/JS/Vue!");
        },
        deleteRecord: function () {
            alert("deleteRecord:\n\nI don't want to work on this hack job any more!\n\nJustin can do this if he wants, I am SICK of HTML/CSS/JS/Vue!")
        },
    }
})

app.refresh();
