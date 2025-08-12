let modelHistChart;
// dictionary of this shape {label: {metric: [...]} }
let metricsByLabel = {};
let applyModelPath = null;

// dropdowns initialization

$('#labelForMetrics').select2();
$('#logisticPenalty').select2();

$('#trainLabelsDropdown').select2({
    tags: false,
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

// metrics table initialization

$('#modelMetricsTable').DataTable({
    order: [[1, 'asc']], // order models by timestamp
    paging: false,
    scrollY: '400px',
    scrollCollapse: true
});

/**
 * Model training using selected parameters: Model type, labels, hyperparameters and features.
 * Updates UI with training output and plots the new model metrics if successful. 
 */
function trainModel() {
    $('#spinner').removeClass("d-none");
    let model_type = $('#modelTabs .nav-link.active').attr('id').replace('-tab', '');
    let features = [];
    $('#featureSelector input.feature-checkbox:checked').each(function () {
        features.push($(this).val());
    });
    $.ajax({
        url: `/train_model`,
        method: "POST",
        data: JSON.stringify({
            model_type: model_type,
            include_labels: $('#trainLabelsDropdown').val(),
            include_features: features,
            hyperparameters: getHyperparameters(model_type)
        }),
        contentType: "application/json",
        success: function (response) {
            $('#spinner').addClass("d-none");
            $('#modelSummary').text(response["output"]);
            if (response["success"]) {
                applyModelPath = response["model_info"]["model_path"]
                $('#modelSummary').removeClass("text-danger");
                addModel(response["model_info"]);
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

function getHyperparameters(model) {
    let params = {};

    if (model === 'logistic') {
        let lambda = parseFloat($('#logisticLambda').val());
        if (isNaN(lambda) || lambda <= 0) lambda = 1;

        params = {
            lambda: lambda,
            penalty: $('#logisticPenalty').val()
        };
    } else if (model === 'random-forest') {
        let nEstimators = parseInt($('#rfEstimators').val());
        let maxDepth = parseInt($('#rfMaxDepth').val());

        params = {
            n_estimators: isNaN(nEstimators) ? null : nEstimators,
            max_depth: isNaN(maxDepth) ? null : maxDepth
        };
    } else if (model === 'neural-net') {
        let epochs = parseInt($('#nnEpochs').val());
        let learningRate = parseFloat($('#nnLearningRate').val());
        let nLayers = parseInt($('#nnLayers').val());

        // units per each layer
        let units = [];
        $('#nnUnitsPerLayerContainer input').each(function () {
            let val = parseInt($(this).val());
            units.push(isNaN(val) || val < 1 ? 1 : val);
        });

        params = {
            epochs: isNaN(epochs) ? null : epochs,
            learning_rate: isNaN(learningRate) ? null : learningRate,
            n_layers: isNaN(nLayers) ? null : nLayers,
            units_per_layer: units
        };
    }

    params.train_test_ratio = $('#trainTestSplit').val();
    params.balance_classes = $("#balanceClassesCheckbox").is(':checked');
    return params;
}

function setHyperparameters(model, params) {
    $('#trainTestSplit').val(params.train_test_ratio);
    $("#balanceClassesCheckbox").prop('checked', params.balance_classes);
    updateLabelFromValue();
    if (model === 'logistic') {
        $('#logisticLambda').val(params.lambda);
        $('#logisticPenalty').val(params.penalty).trigger('change');
    } else if (model === 'random-forest') {
        $('#rfEstimators').val(params.n_estimators);
        $('#rfMaxDepth').val(params.max_depth);
    } else if (model === 'neural-net') {
        $('#nnEpochs').val(params.epochs);
        $('#nnLearningRate').val(params.learning_rate);
        $('#nnLayers').val(params.n_layers).trigger('input');

        params.units_per_layer.forEach((val, i) => {
            $(`input[name="nn_units_layer_${i+1}"]`).val(val);
        });
    }
}


function createUnitPerLayerInputs() {
    const numLayers = parseInt($('#nnLayers').val()) || 0;
    const $container = $('#nnUnitsPerLayerContainer');
    $container.empty();
  
    if (numLayers > 0) {
      const $flexDiv = $('<div class="d-flex flex-wrap gap-2"></div>'); // inline flex container with gaps
  
      for (let i = 1; i <= numLayers; i++) {
        const $inputGroup = $(`
          <div class="d-flex flex-column align-items-center">
            <label class="form-label mb-0" style="font-size: 0.75rem;">Layer ${i}</label>
            <input type="number" min="1" class="form-control form-control-sm" 
                   placeholder="Units" value="10" name="nn_units_layer_${i}" style="width: 80px;">
          </div>
        `);
        $flexDiv.append($inputGroup);
      }
      $container.append($flexDiv);
    }
};

function updateLabelFromValue() {
    const percent = (parseFloat($('#trainTestSplit').val()) * 100).toFixed(0);
    $('#trainTestSplitValue').text(`${percent}%`);
};

/**
 * Fetches the list of previously trained models from the server and plots them.
 */
async function fillModelsList() {
    await $.ajax({
        url: '/models_list',
        method: "POST",
        success: function (response) {
            for (let row of response.data) {
                addModel(row)
            }
        }
    });
}

/**
 * Adds a trained model entry to:
 *  - Model button list (on click read-only view of the model parameters).
 *  - Model bar chart.
 *  - Metrics table.
 * Updates the UI to reflect the new model data.
 * 
 * @param {object} model_info - Information about the trained model, including metrics, name, timestamps, and hyperparameters.
 */
function addModel(model_info) {
    let accuracy = model_info["test_accuracy"];
    let modelName = model_info["model_name"];
    const modelIndex = modelHistChart.data.labels.length;
    const $btn = $('<button></button>')
        .addClass('btn btn-light w-100 text-start mb-2')
        .text(`${modelName} (${Math.round(accuracy * 100)} %) ${model_info["timestamp_end"]}`);
    // hover
    $btn.on('mouseenter', () => highlightBar(modelIndex))
        .on('mouseleave', () => clearHighlight());
    // click
    $btn.on('click', () => {
        $('#modelScroll').find('button').removeClass('btn-dark');
        $btn.addClass('btn-dark');
        fillModelParamsFromExisting(model_info);
    })

    $('#modelScroll').append($btn);

    modelHistChart.data.labels.push(modelName);
    modelHistChart.data.datasets[0].data.push(model_info["test_accuracy"]);
    modelHistChart.data.datasets[1].data.push(model_info["test_f1"]);
    modelHistChart.data.datasets[2].data.push(model_info["train_accuracy"]);
    modelHistChart.data.datasets[3].data.push(model_info["train_f1"]);
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
        model_info["timestamp_end"],
        model_info["test_accuracy"].toFixed(2),
        model_info["test_f1"].toFixed(2),
        model_info["train_accuracy"].toFixed(2),
        model_info["train_f1"].toFixed(2),
        model_info["num_features"],
        model_info["time_taken"].toFixed(2),
    ]).draw(true);

    for (const key in model_info) {
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
        
        // fill with nulls for those models that dont use this labels (missing metrics)
        while (metricsByLabel[label][metricKey].length < modelIndex) {
            metricsByLabel[label][metricKey].push(null);
        }
        metricsByLabel[label][metricKey].push(model_info[key]);

        // if label isn't in the dropdown yet
        if ($("#labelForMetrics").find(`option[value="${label}"]`).length === 0) {
            const newOption = new Option(label.toUpperCase(), label, false, false);
            $("#labelForMetrics").append(newOption)
        }
    }

    // fill with nulls for those models that dont use this labels (missing metrics)
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

/**
 * Fill the input parameters (model type, features, hyperparameters, summary)
 * from existing selected model and sets them to read-only.
 * 
 * @param {object} model_info - The selected model's information.
 */
function fillModelParamsFromExisting(model_info) {
    applyModelPath = model_info["model_path"]; // for the apply button

    $('#modelTabs .nav-link').prop('disabled', 'disabled');
    $('#modelTabs .nav-link').removeClass('active');
    $('#modelTabsContent .tab-pane').removeClass('show active');
    const tabId = `#${model_info["model_type"]}-tab`;
    const paneId = `#${model_info["model_type"]}`;

    $(tabId).addClass('active');
    $(paneId).addClass('show active');
    
    setHyperparameters(model_info["model_type"], model_info["hyperparameters"]);

    $('#featureSelector input.feature-checkbox').each(function () {
        let check = model_info["include_features"].includes($(this).val())
        $(this).prop('checked', check).trigger('change');
    });
    $('#featureSelector input[type="checkbox"]').prop('disabled', true);
    $('#logisticLambda').prop('disabled', true);
    $('#logisticPenalty').prop('disabled', true);

    $('#rfEstimators').prop('disabled', true);
    $('#rfMaxDepth').prop('disabled', true);

    $('#nnEpochs').prop('disabled', true);
    $('#nnLearningRate').prop('disabled', true);
    $('#nnLayers').prop('disabled', true);
    $(`input[name^="nn_units_layer_"]`).prop('disabled', true);

    $('#trainLabelsDropdown').val(model_info["include_labels"]).trigger('change');
    $('#trainLabelsDropdown').prop('disabled', 'disabled');

    $('#trainTestSplit').prop('disabled', true);
    $('#trainTestSplitValue').prop('disabled', true);
    $('#balanceClassesCheckbox').prop('disabled', true);

    $('#trainModelBtn').hide()
    $('#enableTrainBtn').show();

    $('html, body').animate({ scrollTop: 0 }, 250);
    $('#modelSummary').text('');
    setTimeout(() => {
        $('#modelSummary').text(model_info["output"]);
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

/**
 * Loads the list of available features
 * Supports grouping features under parent checkboxes and allows search/filter functionality.
 */
function fillFeatureList() {
    const container = $('#featureSelector');
    container.empty();
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: "/list_available_features",
        method: "POST",
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

function enableTrain() {
    // train another model button
    $('#modelTabs .nav-link').prop('disabled', false);
    $('#trainLabelsDropdown').prop('disabled', false);

    $('#logisticLambda').prop('disabled', false);
    $('#logisticPenalty').prop('disabled', false);

    $('#rfEstimators').prop('disabled', false);
    $('#rfMaxDepth').prop('disabled', false);

    $('#nnEpochs').prop('disabled', false);
    $('#nnLearningRate').prop('disabled', false);
    $('#nnLayers').prop('disabled', false);
    $(`input[name^="nn_units_layer_"]`).prop('disabled', false);

    $('#trainTestSplit').prop('disabled', false);
    $('#trainTestSplitValue').prop('disabled', false);
    $('#balanceClassesCheckbox').prop('disabled', false);

    $('#featureSelector input[type="checkbox"]').prop('disabled', false);
    $('#trainModelBtn').show();
    $('#modelScroll').find('button').removeClass('btn-dark');

    $('#enableTrainBtn').hide();
}