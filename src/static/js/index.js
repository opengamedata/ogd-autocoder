let filename = null;
let modelHistChart;
// dictionary of this shape {label: {metric: [...]} }
let metricsByLabel = {};

$('#tsvFile').on('change', function () {
    if (this.files.length > 0) {
        uploadFile();
    }
});

$('#downloadBtn').on('click', function () {
    const url = `/download?file=${encodeURIComponent(filename)}`;
    window.location.href = url;
});

$('#nav-tab .nav-link').on('shown.bs.tab', function (event) {
    // when tab was switched
    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-segment-tab") {
        $("#load_and_user_panel").removeClass("d-none");
        userChanged();
    } else if (tabId == "nav-label-tab") {
        $("#load_and_user_panel").removeClass("d-none");
        fillLabelDropdown("#labelsDropdown", true);
        userChanged();
    } else if (tabId == "nav-train-tab") {
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none"); // https://stackoverflow.com/questions/8266662/add-class-via-jquery-but-only-when-not-exists
        fillFeatureList();
        fillLabelDropdown("#trainLabelsDropdown", false);
    } else {
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none");
    }
});

function triggerFilePicker() {
    $('#tsvFile').click();
}

function uploadFile() {
    const fileInput = document.getElementById('tsvFile');
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);

    $('#spinner').removeClass("d-none");
    $('#autoSegmentBtn').prop("disabled", "disabled");
    $('#segmentEventTypeDropdown').prop("disabled", "disabled");
    //const fileSizeMB = file.size / (1024 * 1024);
    //let estimatedTime = 0.042 * fileSizeMB + 1.79; // linear regression made from 2 points :)
    $.ajax({
        url: "/upload",
        method: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function (response) {
            filename = response.filename;
            on_file_change(false);
        },
        error: function (xhr, status, error) {
            console.error("Upload failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function load_existing(existing_filename) {
    filename = existing_filename;
    $('#spinner').removeClass("d-none");
    $('#segmentEventTypeDropdown').prop("disabled", "disabled");
    $('#autoSegmentBtn').prop("disabled", "disabled");
    on_file_change(true);
}

function on_file_change(load_models) {
    let promises = [];
    promises.push(fill_users_list());
    promises.push(fill_event_types());
    if (load_models) {
        promises.push(fill_models_list());
    }

    Promise.all(promises)
    .then(() => {
        const tabId = $('#nav-tab .nav-link.active').attr('id');
        if (tabId == "nav-label-tab")
            fillLabelDropdown("#labelsDropdown", true);
        else if (tabId == "nav-train-tab")
            fillLabelDropdown("#trainLabelsDropdown", false);
        
        const table1 = $('#segmentTable').DataTable();
        table1.clear();
        table1.draw();
        const table2 = $('#labelTable').DataTable();
        table2.clear();
        table2.draw();
        
        $('#downloadBtn').show();
        $('#trainModelBtn').show();
        $('#autoSegmentBtn').prop("disabled", "disabled");
        $('#segmentEventTypeDropdown').prop("disabled", "disabled");
        $('#spinner').addClass("d-none");
    }).catch((err) => {
        console.error("Error loading existing file:", err);
    });
}

function fill_models_list() {
    return $.ajax({
        url: '/models_list',
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function (response) {
            for (let row of response.data) {
                addModel(row)
            }
        }
    });
}

function fill_users_list() {
    $('#userDropdown').empty().append('<option></option>');
    return $.ajax({
        url: '/users_list',
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function (response) {
            response.users.forEach(user_id => {
                $('#userDropdown').append(`<option value="${user_id}">${user_id}</option>`);
            });

            // Initialize or reinitialize Select2
            $('#userDropdown').select2({
                placeholder: "Select a user",
                width: '100%',
            });

            $('#userDropdown').show();
        },
        error: function (xhr, status, error) {
            console.error("User list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function fill_event_types() {
    $('#segmentEventTypeDropdown').empty();
    return $.ajax({
        url: '/event_types_list',
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function (response) {
            response.users.forEach(event_type => {
                $('#segmentEventTypeDropdown').append(`<option value="${event_type}">${event_type}</option>`);
            });

            $('#segmentEventTypeDropdown').show();
        },
        error: function (xhr, status, error) {
            console.error("Event type list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function nextSegment() {
    const select = $('#segmentDropdown');
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (current + 1) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

function prevSegment() {
    const select = $('#segmentDropdown');
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (options.length + (current - 1)) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

function fillSegmentDropdown() {
    $('#segmentDropdown').empty();
    $('#segmentDropdown').select2({
        placeholder: "...",
        width: '40%',
    });
    const user_id = $('#userDropdown').val();
    if (user_id) {
        $('#spinner').removeClass("d-none");
        $.ajax({
            url: `/list_segment_ids/${user_id}`,
            method: "POST",
            data: JSON.stringify({ filename: filename }),
            contentType: "application/json",
            success: function (response) {
                response.data.forEach(seg_id => {
                    $('#segmentDropdown').append(`<option value="${seg_id}">${seg_id}</option>`);
                });
                $('#spinner').addClass("d-none");

                loadEvents("#labelTable");
            },
            error: function (xhr, status, error) {
                console.error("Segment options loading failed:", status, error);
                console.log("Server response:", xhr.responseText);
            }
        });
    }
}

$('#importLabelsBtn').on('click', function () {
    $('#importLabelsFile').click();
});

$('#importLabelsFile').on('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const rows = JSON.parse(e.target.result);
            const $dropdown = $('#labelsDropdown');

            $.each(rows, function (i, row) {
                if (row.code && row.definition) {
                    const $option = $('<option>')
                        .val(row.code)
                        .text(row.code)
                        .attr('title', row.definition);

                    $dropdown.append($option);
                }
            });
        } catch (err) {
            alert('Invalid JSON file, please check the format, e.g. {"code": "struggle", "definition": "player does not understand sth"}.');
        }
    };

    reader.readAsText(file);
});

for (let table_id of ["#labelTable", "#segmentTable"]) {
    $(table_id).DataTable({
        select: { style: 'multi' },
        order: [[3, 'asc']],
        paging: false,
        scrollY: '400px',
        scrollCollapse: true,
        colReorder: true,
        columnDefs: [
            { targets: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], visible: false },
        ],
        dom: '<"top d-flex justify-content-between align-items-center"fB>rt<"bottom"ip>',
        buttons: ['colvis'],
    });
}

// order models by timestamp
$('#modelMetricsTable').DataTable({
    order: [[1, 'asc']],
    paging: false,
    scrollY: '400px',
    scrollCollapse: true
});

$('#modelTypeSelect').select2();
$('#labelForMetrics').select2();
$('#labelsDropdown').select2();
$('#trainLabelsDropdown').select2();
$('#segmentEventTypeDropdown').select2();

function addModel(metrics) {
    let accuracy = metrics["test_accuracy"];
    let modelName = metrics["model_name"];
    const modelIndex = modelHistChart.data.labels.length;
    const $btn = $('<button></button>')
        .addClass('btn btn-light w-100 text-start mb-2')
        .text(`${modelName} (${Math.round(accuracy * 100)} %) ${metrics["timestamp_end"]}`);
    // hover
    $btn.on('mouseenter', () => highlightBar(modelIndex))
        .on('mouseleave', () => clearHighlight());
    // click
    $btn.on('click', () => {
        $('#modelScroll').find('button').removeClass('btn-dark');
        $btn.addClass('btn-dark');
        fillModelSummary(metrics);
    })

    $('#modelScroll').append($btn);

    modelHistChart.data.labels.push(modelName);
    modelHistChart.data.datasets[0].data.push(metrics["test_accuracy"]);
    modelHistChart.data.datasets[1].data.push(metrics["test_f1"]);
    modelHistChart.data.datasets[2].data.push(metrics["train_accuracy"]);
    modelHistChart.data.datasets[3].data.push(metrics["train_f1"]);
    modelHistChart.data.datasets[4].data.push(0); // just for hovers, otherwise it breaks
    modelHistChart.data.datasets[5].data.push(0);
    modelHistChart.data.datasets[6].data.push(0);
    modelHistChart.data.datasets[7].data.push(0);
    
    // resize for horizontal scrollbar
    const wrapper = $('#chartCanvasWrapper');
    const labelCount = modelHistChart.data.labels.length;
    const requiredWidth = labelCount * 120; // size for 2-4 bars

    wrapper.width(requiredWidth);

    modelHistChart.resize();

    // scroll to the end
    $('#chartScrollWrapper').scrollLeft(wrapper[0].scrollWidth);

    // applying ALL changes
    modelHistChart.update();


    // updating table view
    let table = $('#modelMetricsTable').DataTable();

    table.row.add([
        modelName,
        metrics["timestamp_end"],
        metrics["test_accuracy"].toFixed(2),
        metrics["test_f1"].toFixed(2),
        metrics["train_accuracy"].toFixed(2),
        metrics["train_f1"].toFixed(2),
        metrics["num_features"],
        metrics["time_taken"],
    ]).draw(true);

    for (const key in metrics) {
        let type = null;
        let parts = [];

        if (key.includes("recall")) {
            type = "recall";
            parts = key.split("recall");
        } else if (key.includes("precision")) {
            type = "precision";
            parts = key.split("precision");
        } else {
            continue; // skip other metrics
        }
        let metricKey = parts[0] + type;
        let label = parts[1].substring(1);

        metricsByLabel[label] ??= {}; // ??= assigns if null
        metricsByLabel[label][metricKey] ??= [];
        
        // fill with nulls for those models that dont use this labels
        while (metricsByLabel[label][metricKey].length < modelIndex) {
            metricsByLabel[label][metricKey].push(null);
        }
        metricsByLabel[label][metricKey].push(metrics[key]);

        // if label isn't in the dropdown yet
        if ($("#labelForMetrics").find(`option[value="${label}"]`).length === 0) {
            const newOption = new Option(label.toUpperCase(), label, false, false);
            $("#labelForMetrics").append(newOption)
        }
    }

    // fill with nulls for those models that dont use this labels
    for (const label in metricsByLabel) {
        for (const metricKey in metricsByLabel[label]) {
          if (metricsByLabel[label][metricKey]) {
            while (metricsByLabel[label][metricKey].length < modelIndex) {
                metricsByLabel[label][metricKey].push(null);
            }
          }
        }
    }
}

function fillModelSummary(metrics) {
    $('#modelTypeSelect').val(metrics["model_type"]).trigger('change');
    $('#modelTypeSelect').prop('disabled', 'disabled');


    $('#featureSelector input.feature-checkbox').each(function () {
        let check = metrics["include_features"].includes($(this).val())
        $(this).prop('checked', check).trigger('change');
    });
    $('#featureSelector input[type="checkbox"]').prop('disabled', true);
    $('#trainLabelsDropdown').val(metrics["include_labels"]).trigger('change');
    $('#trainLabelsDropdown').prop('disabled', 'disabled');
    $('#trainModelBtn').hide()
    $('#enableTrainBtn').show();

    $('html, body').animate({ scrollTop: 0 }, 250);
    $('#modelSummary').text('');
    setTimeout(() => {
        $('#modelSummary').text(metrics["output"]);
    }, 300);
}

function highlightBar(index) {
    modelHistChart.setActiveElements([
        { datasetIndex: 0, index },
        { datasetIndex: 1, index },
        { datasetIndex: 2, index },
        { datasetIndex: 3, index },
        { datasetIndex: 4, index },
        { datasetIndex: 5, index },
        { datasetIndex: 6, index },
        { datasetIndex: 7, index }
    ]);
    modelHistChart.tooltip.setActiveElements([
        { datasetIndex: 0, index },
        { datasetIndex: 1, index },
        { datasetIndex: 2, index },
        { datasetIndex: 3, index },
        { datasetIndex: 4, index },
        { datasetIndex: 5, index },
        { datasetIndex: 6, index },
        { datasetIndex: 7, index }
    ]);
    modelHistChart.update();
}

function clearHighlight() {
    modelHistChart.setActiveElements([]);
    modelHistChart.tooltip.setActiveElements([]);
    modelHistChart.update();
}

const ctx = $('#modelsBarChart')[0].getContext('2d');
Chart.register(ChartDataLabels);

modelHistChart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: [], // Fill this with model names dynamically
        datasets: [
            {
                label: 'Test Accuracy',
                data: [],
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1,
            },
            {
                label: 'Test F1 Score',
                data: [],
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1,
                hidden: true
            },
            {
                label: 'Train Accuracy',
                data: [],
                backgroundColor: 'rgba(255, 159, 64, 0.6)',
                borderColor: 'rgba(255, 159, 64, 1)',
                borderWidth: 1,
                hidden: true
            },
            {
                label: 'Train F1 Score',
                data: [],
                backgroundColor: 'rgba(153, 102, 255, 0.6)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 1,
                hidden: true
            },
            {
                label: 'Test Precision',
                data: [],
                backgroundColor: 'rgba(255, 99, 132, 0.6)',
                borderColor: 'rgba(255, 99, 132, 1)',
                borderWidth: 1,
                hidden: true
            },
            {
                label: 'Test Recall',
                data: [],
                backgroundColor: 'rgba(255, 206, 86, 0.6)',
                borderColor: 'rgba(255, 206, 86, 1)',
                borderWidth: 1,
                hidden: true
            },
            {
                label: 'Train Precision',
                data: [],
                backgroundColor: 'rgba(201, 203, 207, 0.6)',
                borderColor: 'rgba(201, 203, 207, 1)',
                borderWidth: 1,
                hidden: true
            },
            {
                label: 'Train Recall',
                data: [],
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderColor: 'rgba(0, 0, 0, 1)',
                borderWidth: 1,
                hidden: true
            },
        ]
    },
    plugins: [{
        beforeInit(chart) {
            // https://stackoverflow.com/questions/42585861/chart-js-increase-spacing-between-legend-and-chart/67723827#67723827
            // Get a reference to the original fit function
            const originalFit = chart.legend.fit;

            // Override the fit function
            chart.legend.fit = function fit() {
                // Call the original function and bind scope in order to use `this` correctly inside it
                originalFit.bind(chart.legend)();
                // Change the height as suggested in other answers
                this.height += 15;
            }
        }
    }],
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                max: 1,
                ticks: {
                    callback: val => val.toFixed(2)
                }
            }
        },
        plugins: {
            legend: { display: true },
            tooltip: {
                callbacks: {
                    label: function (tooltipItem) {
                        const datasetIndex = tooltipItem.datasetIndex;
                        const meta = tooltipItem.chart.getDatasetMeta(datasetIndex);

                        // Only show tooltip if dataset is not hidden
                        if (!meta.hidden) {
                            const label = tooltipItem.dataset.label || '';
                            const value = tooltipItem.raw;
                            return `${label}: ${value == null ? "NA" : (value * 100).toFixed(1)}%`;
                        }
                        return null;
                    }
                }
            },
            datalabels: {
                color: 'black',
                anchor: 'end',
                align: 'end',
                offset: 0,
                formatter: function (value) {
                    if (value == null)
                        return null

                    return value == 0 ? 0 : value.toFixed(2);
                }
            }
        }
    }
});

toggleBarsForLabel();

function toggleBarsForLabel() {
    let label = $("#labelForMetrics").val();
    let columns = ["Test Accuracy", "Test F1 Score", "Train Accuracy", "Train F1 Score"];
    let colToShow = ["Test Accuracy", "Test F1 Score"];
    if (label != "all") {
        columns = ["Test Precision", "Test Recall", "Train Precision", "Train Recall"];
        colToShow = ["Test Precision", "Test Recall"];

        modelHistChart.data.datasets[4].data = metricsByLabel[label]["test_precision"];
        modelHistChart.data.datasets[5].data = metricsByLabel[label]["test_recall"];
        modelHistChart.data.datasets[6].data = metricsByLabel[label]["train_precision"];
        modelHistChart.data.datasets[7].data = metricsByLabel[label]["train_recall"];
        modelHistChart.update();
    }

    modelHistChart.data.datasets.forEach((ds, i) => {
        const meta = modelHistChart.getDatasetMeta(i);
        meta.hidden = !colToShow.includes(ds.label);
    });

    modelHistChart.update();

    modelHistChart.options.plugins.legend.labels.filter = (legendItem) => {
        return columns.includes(legendItem.text);
    };

    modelHistChart.update();
}

function fillFeatureList() {
    if (!filename) {
        return;
    }
    const container = $('#featureSelector');
    container.empty();
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: "/list_available_features",
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function (response) {
            for (group of response.data) {
                if (group.children.length > 1) {
                    group_content = $(`
                    <div class="mb-1">
                        <div class="form-check">
                            <input class="form-check-input group-checkbox" type="checkbox" id="${group.name}" checked>
                            <label class="form-check-label fw-bold" for="${group.name}">${group.name}</label>
                        </div>
                    </div>`);
                    features = $(`<div class="ms-3" id="${group.name}-features"></div>`)
                    group.children.forEach(feature => {
                        features.append(`
                            <div class="form-check">
                                <input class="form-check-input feature-checkbox" type="checkbox" value="${feature}" id="feature-${feature}" checked>
                                <label class="form-check-label" for="feature-${feature}">
                                    ${feature}
                                </label>
                            </div>
                        `);
                    });
                    features.appendTo(group_content);
                    group_content.appendTo(container);
                } else {
                    feature = group.children[0]
                    container.append($(
                        `<div class="form-check">
                        <input class="form-check-input feature-checkbox" type="checkbox" value="${feature}" id="feature-${feature}" checked>
                        <label class="form-check-label" for="feature-${feature}">
                            ${feature}
                        </label>
                    </div>`));
                }
            }
            $('.feature-checkbox').on('change', function () {
                $('.group-checkbox').each(function () {
                    const groupId = $(this).attr('id');
                    const allChecked = $(`#${groupId}-features .feature-checkbox`).length > 0 &&
                        $(`#${groupId}-features .feature-checkbox:not(:checked)`).length === 0;

                    $(this).prop('checked', allChecked);
                });
            });

            $('.group-checkbox').on('change', function () {
                const groupId = $(this).attr('id');
                $(`#${groupId}-features input[type=checkbox]`).prop('checked', this.checked);
            });

            $('#featureSearch').on('input', function () {
                const query = $(this).val().toLowerCase();

                $('.feature-checkbox').each(function () {
                    // $(this).next() is the label element
                    const featureName = $(this).next().text().toLowerCase();
                    if (featureName.includes(query)) {
                        $(this).parent().show();
                    } else {
                        $(this).parent().hide();
                    }
                });

                $('.group-checkbox').each(function () {
                    const hasVisibleChild = $(this).parent().parent().find('.feature-checkbox:visible').length > 0;
                    if (hasVisibleChild)
                        $(this).parent().show();
                    else
                        $(this).parent().hide();
                });
            });

            $('#spinner').addClass("d-none");
        },
        error: function (xhr, status, error) {
            console.error("Feature list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function fillLabelDropdown(dropdown_id, allow_new_lbl) {
    // dropdown_id: #labelsDropdown | #trainLabelsDropdown
    // allow_new_lbl: allows adding new labels to the dropdown

    // don't remove the uploaded options from codebook.csv
    if (!filename) {
        return;
    }
    $(dropdown_id).val("");
    $(dropdown_id).children(':not([title])').remove();
    $(dropdown_id).select2({
        tags: allow_new_lbl,
        placeholder: '...',
        width: '100%',
        templateResult: function formatOption(option) {
            let template = '<div><strong>' + option.text + '</strong></div>';
            if (option.title) {
                template += '<div>' + option.title + '</div>'
            }
            return $(template);
        }
    });
    
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: "/list_labels",
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function (response) {
            response.data.forEach(label => {
                if ($(`${dropdown_id} option[value="${label}"]`).length === 0) { // don't repeat codebook options
                    $(dropdown_id).append(`<option value="${label}">${label}</option>`);
                }
            });
            $('#spinner').addClass("d-none");
        },
        error: function (xhr, status, error) {
            console.error("Label options loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function userChanged() {
    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-segment-tab") {
        loadEvents("#segmentTable");
    } else if (tabId == "nav-label-tab") {
        fillSegmentDropdown();
    }
}

function loadEvents(table_id) {
    // table_id: #segmentTable | #labelTable
    const table = $(table_id).DataTable();
    table.clear();
    
    let segment_id = null;
    if (table_id == "#labelTable") {
        segment_id = $('#segmentDropdown').val()

        // needs a segment_id
        if (!segment_id) {
            table.draw();
            return;
        }
    }

    const user_id = $('#userDropdown').val();
    if (!user_id) {
        table.draw();
        return;
    }

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/events/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename, segment_id: segment_id }),
        contentType: "application/json",
        success: function (response) {
            let data = response.data;

            data.forEach(row => {
                table.row.add([
                    row.index,
                    row.event_name,
                    row.job_name,
                    row.timestamp,
                    row.segment_id,
                    row.segment_labels,
                    row.label_justification,
                    row.session_id,
                    row.app_id,
                    row.event_data,
                    row.event_source,
                    row.app_version,
                    row.app_branch,
                    row.log_version,
                    row.offset,
                    row.user_id,
                    row.user_data,
                    row.game_state
                ]);
            });

            table.draw();

            $('#spinner').addClass("d-none");
            $('#autoSegmentBtn').prop("disabled", false);
            $('#segmentEventTypeDropdown').prop("disabled", false);
        },
        error: function (xhr, status, error) {
            console.error("Event data load failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function segmentRows() {
    let table_id = "#segmentTable";
    const user_id = $('#userDropdown').val();
    const selectedRows = $(table_id).DataTable().rows({ selected: true }).data().toArray();
    if (selectedRows.length == 0) {
        alert("Please, select at least one row!")
        return;
    }
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/segment/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({
            filename: filename,
            selected_rows: selectedRows.map(row => [row[0], row[3]]),
            segment_id: $("#segmentIdInput").val(),
        }),
        contentType: "application/json",
        success: function (response) {
            // autoincrement
            let next_segment_id = parseInt($("#segmentIdInput").val()) + 1
            $("#segmentIdInput").val(next_segment_id);

            // reload data
            loadEvents(table_id);
        },
        error: function (xhr, status, error) {
            console.error("Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function labelRows() {
    let table_id = "#labelTable";
    const user_id = $('#userDropdown').val();
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/label/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({
            filename: filename,
            segment_id: $("#segmentDropdown").val(),
            segment_labels: $('#labelsDropdown').val().join(', '),
            label_justification: $('#labelJustificationInput').val()
        }),
        contentType: "application/json",
        success: function (response) {
            // reload data
            fillLabelDropdown("#labelsDropdown", true);
            $('#labelJustificationInput').val("")
            loadEvents(table_id);
        },
        error: function (xhr, status, error) {
            console.error("Labeling failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function autoSegment() {
    // hide modal
    bootstrap.Modal.getInstance($('#confirmSegmentModal')[0]).hide();

    let table_id = "#segmentTable"

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: '/autosegment',
        method: "POST",
        data: JSON.stringify({ filename: filename,  sep_event_types: $('#segmentEventTypeDropdown').val()}),
        contentType: "application/json",
        success: function (response) {
            // reload data
            loadEvents(table_id);
        },
        error: function (xhr, status, error) {
            console.error("Auto Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function enableTrain() {
    $('#modelTypeSelect').prop('disabled', false);
    $('#trainLabelsDropdown').prop('disabled', false);
    $('#featureSelector input[type="checkbox"]').prop('disabled', false);
    $('#trainModelBtn').show();
    $('#modelScroll').find('button').removeClass('btn-dark');

    $('#enableTrainBtn').hide();
}

function trainModel() {
    $('#spinner').removeClass("d-none");

    let features = [];
    $('#featureSelector input.feature-checkbox:checked').each(function () {
        features.push($(this).val());
    });
    $.ajax({
        url: `/train_model`,
        method: "POST",
        data: JSON.stringify({ filename: filename, model_type: $('#modelTypeSelect').val(), include_labels: $('#trainLabelsDropdown').val(), include_features: features }),
        contentType: "application/json",
        success: function (response) {
            $('#spinner').addClass("d-none");
            $('#modelSummary').text(response["output"]);
            if (response["success"]) {
                $('#modelSummary').removeClass("text-danger");
                addModel(response["metrics"]);
            } else {
                $("#modelSummary:not([class*='text-danger'])").addClass("text-danger");
            }
        },
        error: function (xhr, status, error) {
            console.error("Model Training failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}