let tables = {};
let filename = null;
let modelHistChart;

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
    if (["nav-segment-tab", "nav-label-tab"].includes(tabId)) {
        $("#load_and_user_panel").removeClass("d-none");
        userChanged();
    } else if (tabId == "nav-train-tab") {
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none"); // https://stackoverflow.com/questions/8266662/add-class-via-jquery-but-only-when-not-exists
        fillFeatureList();
    } else {
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none")
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
    $('#autoSegmentBtn').hide();
    $('#userDropdown').empty().append('<option></option>');
    //const fileSizeMB = file.size / (1024 * 1024);
    //let estimatedTime = 0.042 * fileSizeMB + 1.79; // linear regression made from 2 points :)
    $.ajax({
        url: "/upload",
        method: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function(response) {
            $('#spinner').addClass("d-none");
            filename = response.filename;
            response.user_ids.forEach(user_id => {
                $('#userDropdown').append(`<option value="${user_id}">${user_id}</option>`);
            });

            // Initialize or reinitialize Select2
            $('#userDropdown').select2({
                placeholder: "Select a user",
                width: '100%',
            });

            $('#userDropdown').show();
            $('#downloadBtn').show();
            $('#trainModelBtn').show();
        },
        error: function(xhr, status, error) {
            console.error("Upload failed:", status, error);
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
            data: JSON.stringify({filename: filename}),
            contentType: "application/json",
            success: function(response) {
                response.data.forEach(seg_id => {
                    $('#segmentDropdown').append(`<option value="${seg_id}">${seg_id}</option>`);
                });
                $('#spinner').addClass("d-none");

                const segment_id = $('#segmentDropdown').val();
                loadEvents("#labelTable", segment_id);
            },
            error: function(xhr, status, error) {
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

// order models by timestamp
$('#modelMetricsTable').DataTable({order: [[1, 'desc']]});

function addModel(modelName, metrics) {
    let accuracy = metrics["test_accuracy"];
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ` +
                    `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    
    const modelIndex = modelHistChart.data.labels.length;
    const $btn = $('<button></button>')
        .addClass('btn btn-light w-100 text-start mb-2')
        .text(`${modelName} (${Math.round(accuracy * 100)} %) ${timestamp}`)
        .on('mouseenter', () => highlightBar(modelIndex))
        .on('mouseleave', () => clearHighlight());
    $('#modelScroll').append($btn);

    modelHistChart.data.labels.push(modelName);
    modelHistChart.data.datasets[0].data.push(metrics["test_accuracy"]);
    modelHistChart.data.datasets[1].data.push(metrics["test_f1"]);
    modelHistChart.data.datasets[2].data.push(metrics["train_accuracy"]);
    modelHistChart.data.datasets[3].data.push(metrics["train_f1"]);
    modelHistChart.update();

    // updating table view
    let table = $('#modelMetricsTable').DataTable();
    
    table.row.add([
        modelName,
        timestamp,
        metrics["test_accuracy"].toFixed(2),
        metrics["test_f1"].toFixed(2),
        metrics["train_accuracy"].toFixed(2),
        metrics["train_f1"].toFixed(2),
    ]).draw(true);
}

function highlightBar(index) {
    modelHistChart.setActiveElements([
        { datasetIndex: 0, index },
        { datasetIndex: 1, index },
        { datasetIndex: 2, index },
        { datasetIndex: 3, index }
    ]);
    modelHistChart.tooltip.setActiveElements([
        { datasetIndex: 0, index },
        { datasetIndex: 1, index },
        { datasetIndex: 2, index },
        { datasetIndex: 3, index }
    ]);
    modelHistChart.update();
}

function clearHighlight() {
    modelHistChart.setActiveElements([]);
    modelHistChart.tooltip.setActiveElements([]);
    modelHistChart.update();
}


const ctx = $('#modelsBarChart')[0].getContext('2d');
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
        }
        ]
    },
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
            label: ctx => `${ctx.dataset.label}: ${(ctx.raw * 100).toFixed(1)}%`
            }
        }
        }
    }
});  

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
        data: JSON.stringify({filename: filename}),
        contentType: "application/json",
        success: function(response) {
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
        error: function(xhr, status, error) {
            console.error("Feature list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function fillLabelDropdown() {
    // don't remove the uploaded options from codebook.csv
    $('#labelsDropdown').val("");
    $('#labelsDropdown').children(':not([title])').remove();
    $('#labelsDropdown').select2({
        tags: true,
        placeholder: '...',
        width: '100%',
        templateResult: function formatOption (option) {
            let template = '<div><strong>' + option.text + '</strong></div>';
            if (option.title) {
                template += '<div>' + option.title + '</div>'
            }
            return $(template);
        }
      });
    const user_id = $('#userDropdown').val();
    if (user_id) {
        $('#spinner').removeClass("d-none");
        $.ajax({
            url: "/list_labels",
            method: "POST",
            data: JSON.stringify({filename: filename}),
            contentType: "application/json",
            success: function(response) {
                response.data.forEach(label => {
                    if ($(`#labelsDropdown option[value="${label}"]`).length === 0) { // don't repeat codebook options
                        $('#labelsDropdown').append(`<option value="${label}">${label}</option>`);
                    }
                });
                $('#spinner').addClass("d-none");
            },
            error: function(xhr, status, error) {
                console.error("Label options loading failed:", status, error);
                console.log("Server response:", xhr.responseText);
            }
        });
    }
}

function userChanged() {
    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-segment-tab") {
        loadEvents("#segmentTable");
    } else if (tabId == "nav-label-tab") {
        fillSegmentDropdown();
        fillLabelDropdown();
    }
}


function loadEvents(table_id) {
    // table_id: #segmentTable | #labelTable
    let segment_id = null;
    if (table_id == "#labelTable") {
        segment_id = $('#segmentDropdown').val()
        if (!segment_id) return; // needs a segment_id
    }

    const user_id = $('#userDropdown').val();
    if (!user_id) return;

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/events/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename, segment_id: segment_id }),
        contentType: "application/json",
        success: function(response) {
            let data = response.data;
            if (tables[table_id]) {
                tables[table_id].destroy();
                $(`${table_id} tbody`).empty();
            }

            data.forEach(row => {
            $(`${table_id} tbody`).append(
                `<tr>
                <td>${row.index}</td>
                <td>${row.event_name}</td>
                <td>${row.job_name}</td>
                <td>${row.timestamp}</td>
                <td>${row.segment_id}</td>
                <td>${row.segment_labels}</td>
                <td>${row.label_justification}</td>
                </tr>`
            );
            });
            tables[table_id] = $(table_id).DataTable({
                select: { style: 'multi' },
                order: [[3, 'asc']],
                paging: false,
                scrollY: '400px',
                scrollCollapse: true
            });

            $('#spinner').addClass("d-none");
            $('#autoSegmentBtn').show();
        },
        error: function(xhr, status, error) {
            console.error("Event data load failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function segmentRows() {
    let table_id = "#segmentTable";
    const user_id = $('#userDropdown').val();
    const selectedRows = tables[table_id].rows({ selected: true }).data().toArray();
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
        success: function(response) {
            // autoincrement
            let next_segment_id = parseInt($("#segmentIdInput").val()) + 1
            $("#segmentIdInput").val(next_segment_id);
    
            // reload data
            loadEvents(table_id);
        },
        error: function(xhr, status, error) {
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
        success: function(response) {    
            // reload data
            fillLabelDropdown();
            $('#labelJustificationInput').val("")
            loadEvents(table_id);
        },
        error: function(xhr, status, error) {
            console.error("Labeling failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function autoSegment() {
    // hide modal
    bootstrap.Modal.getInstance($('#confirmSegmentModal')[0]).hide();

    const user_id = $('#userDropdown').val();
    let table_id = "#segmentTable"

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/autosegment/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename,}),
        contentType: "application/json",
        success: function(response) {
            // reload data
            loadEvents(table_id);
        },
        error: function(xhr, status, error) {
            console.error("Auto Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function trainModel() {
    $('#spinner').removeClass("d-none");

    let features = [];
    $('#featureSelector input.feature-checkbox:checked').each(function () {
        features.push($(this).val());
    });
    let modelTypeHumRead = $('#modelTypeSelect option:selected').text()

    $.ajax({
        url: `/train_model`,
        method: "POST",
        data: JSON.stringify({ filename: filename, model_type: $('#modelTypeSelect').val(), include_features: features}),
        contentType: "application/json",
        success: function(response) {
            $('#spinner').addClass("d-none");
            $('#modelSummary').text(response["output"]);
            addModel(modelTypeHumRead, response["metrics"])
        },
        error: function(xhr, status, error) {
            console.error("Model Training failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}