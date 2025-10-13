let modelHistChart, pcaChart;
// dictionary of this shape {label: {metric: [...]} }
let metricsByLabel = {};
let applyModelPath = null;
let bestModel = { test_accuracy: 0, path: null }; // best selected by test accuracy
let correlationMatrix = null; // used for correlations
let avoidOnChange = false; // if true dont run trainLabelsDropdown onchange (correlation loading)

let isResizing = false;
// resizing sidebars
$(".resizer").on("mousedown", function (e) {
    e.preventDefault();
    isResizing = true;

    let leftCol = $("#" + $(this).data("left-col"));
    let rightCol = $("#" + $(this).data("right-col"));

    let startX = e.pageX;
    let startWidth = leftCol.width();
    let nextStartWidth = rightCol.width();

    $(document).on("mousemove.resize", function (e) {
        if (!isResizing) return;

        const dx = e.pageX - startX;
        const newWidth = startWidth + dx;
        const newNextWidth = nextStartWidth - dx;

        if (newWidth > 150 && newNextWidth > 150) { // minimum widths
            leftCol.css({ flex: "none", width: newWidth + "px" });
            rightCol.css({ flex: "none", width: newNextWidth + "px" });
        }
    });

    $(document).on("mouseup.resize", function () {
        isResizing = false;
        $(document).off(".resize");
    });
});

// dropdowns initialization

$('#labelForMetrics').select2();
$('#logisticPenalty').select2();
$('#scalerSelect').select2();

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

$('#collapsePca').on('shown.bs.collapse', function () {
    fillPCAPlot(); // Call when shown
});

/**
 * Updates PCA plot with explained variance and its cumulative value for n_components in the range of (1, n_columns) 
 */
function fillPCAPlot() {
    $('#spinner').removeClass("d-none");
    let model_type = $('#modelTabs .nav-link.active').attr('id').replace('-tab', '');
    let features = [];
    $('#includedFeatures').children('li').each(function () {
        features.push($(this).data("elem-name"));
    });
    let data = {
        include_labels: $('#trainLabelsDropdown').val(),
        include_features: features,
        hyperparameters: getHyperparameters(model_type)
    };
    send_request('pca_details', data).then((response) => {
        $('#spinner').addClass("d-none");

        pcaChart.data.datasets[0].data = response["explained_variance"];
        pcaChart.data.datasets[1].data = response["cumulative"];
        pcaChart.data.labels = response["explained_variance"].map((val, ind) => ind + 1);
        pcaChart.update();
    });
}

/**
 * Model training using selected parameters: Model type, labels, hyperparameters and features.
 * Updates UI with training output and plots the new model metrics if successful. 
 */
function trainModel() {
    $('#spinner').removeClass("d-none");
    let model_type = $('#modelTabs .nav-link.active').attr('id').replace('-tab', '');
    let features = [];
    $('#includedFeatures').children('li').each(function () {
        features.push($(this).data("elem-name"));
    });

    let data = {
        model_type: model_type,
        include_labels: $('#trainLabelsDropdown').val(),
        include_features: features,
        hyperparameters: getHyperparameters(model_type)
    };
    send_request('train_model', data).then((response) => {
        $('#spinner').addClass("d-none");
            
        $('#modelSummary').text(response["output"]);
        applyModelPath = response["model_info"]["model_path"]
        addModel(response["model_info"]);
        increaseModelsCount(1);
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
    params.scaling = $("#scalerSelect").val();
    let val = parseInt($('#pcaComps').val());
    params.pca_comps = isNaN(val) ? 0 : val;
    return params;
}

function setHyperparameters(model, params) {
    $('#trainTestSplit').val(params.train_test_ratio);
    $("#balanceClassesCheckbox").prop('checked', params.balance_classes);
    $("#scalerSelect").val(params.scaling).trigger('change');
    $('#pcaComps').val(params.pca_comps);
    updateLabelFromSlider('#trainTestSplit', '#trainTestSplitValue');
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
            $(`input[name="nn_units_layer_${i + 1}"]`).val(val);
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

function updateLabelFromSlider(slider_id, label_id) {
    const percent = (parseFloat($(slider_id).val()) * 100).toFixed(0);
    $(label_id).text(`${percent}`);
};

/**
 * Fetches the list of previously trained models from the server and plots them.
 */
async function fillModelsList() {
    await send_request('models_list', {}).then((response) => {
        for (let row of response.data) {
            addModel(row)
        }
        increaseModelsCount(response.data.length);
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
    if (accuracy > bestModel.test_accuracy) {
        bestModel.test_accuracy = accuracy;
        bestModel.path = model_info["model_path"]
    }


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
    modelHistChart.data.datasets[2].data.push(model_info["test_auc"]);
    modelHistChart.data.datasets[3].data.push(model_info["train_accuracy"]);
    modelHistChart.data.datasets[4].data.push(model_info["train_f1"]);
    modelHistChart.data.datasets[5].data.push(model_info["train_auc"]);
    modelHistChart.data.datasets[6].data.push(0); // just for hovers, otherwise it breaks
    modelHistChart.data.datasets[7].data.push(0);
    modelHistChart.data.datasets[8].data.push(0);
    modelHistChart.data.datasets[9].data.push(0);

    // resize for horizontal scrollbar
    const wrapper = $('#chartCanvasWrapper');
    const labelCount = Math.max(2, modelHistChart.data.labels.length);
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
        model_info["test_auc"].toFixed(2),
        model_info["train_accuracy"].toFixed(2),
        model_info["train_f1"].toFixed(2),
        model_info["train_auc"].toFixed(2),
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
function addMoveAllElemsHandler(buttonId, fromListId) {
    $(buttonId).on('click', () => {
        $(fromListId).children("li:visible").each(function () {
            $(this).find("button").click();
        });
    });
}
addMoveAllElemsHandler("#allToExcluded", "#includedFeatures");
addMoveAllElemsHandler("#allToIncluded", "#excludedFeatures");
addMoveAllElemsHandler("#allToExcludedEvt", "#includedEvents");
addMoveAllElemsHandler("#allToIncludedEvt", "#excludedEvents");

/**
 * Fill the input parameters (model type, features, hyperparameters, summary)
 * from existing selected model and sets them to read-only.
 * 
 * @param {object} model_info - The selected model's information.
 */
function fillModelParamsFromExisting(model_info) {
    avoidOnChange = true;
    applyModelPath = model_info["model_path"]; // for the apply button

    $('#modelTabs .nav-link').prop('disabled', 'disabled');
    $('#modelTabs .nav-link').removeClass('active');
    $('#modelTabsContent .tab-pane').removeClass('show active');
    const tabId = `#${model_info["model_type"]}-tab`;
    const paneId = `#${model_info["model_type"]}`;

    $(tabId).addClass('active');
    $(paneId).addClass('show active');

    setHyperparameters(model_info["model_type"], model_info["hyperparameters"]);

    $('#includedFeatures').children("li").each(function () {
        if (!model_info["include_features"].includes($(this).data("elem-name"))) {
            // excluding feature
            $(this).find("button").click();
        }
    });
    $('#excludedFeatures').children("li").each(function () {
        if (model_info["include_features"].includes($(this).data("elem-name"))) {
            // include feature
            $(this).find("button").click();
        }
    });

    $('#includedFeatures button').prop('disabled', true);
    $('#excludedFeatures button').prop('disabled', true);
    $("#allToExcluded").prop('disabled', true);
    $("#allToIncluded").prop('disabled', true);
    updateNumSelected('#includedFeatures', '#excludedFeatures', true);

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
    $('#scalerSelect').prop('disabled', true);
    $('#pcaComps').prop('disabled', true);
    $('#trainModelBtn').hide()
    $('#enableTrainBtn').show();

    $('#modelSummary').text(model_info["output"]);
    avoidOnChange = false;
}

function highlightBar(index) {
    $('#chartScrollWrapper').stop(true).animate(
        { scrollLeft: 120 * index },
        {
            duration: 500,
            easing: 'linear'
        }
    );
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
                label: 'Test AUC Score',
                data: [],
                backgroundColor: 'rgba(255, 99, 132, 0.6)',
                borderColor: 'rgba(255, 99, 132, 1)',
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
                label: 'Train AUC Score',
                data: [],
                backgroundColor: 'rgba(0, 204, 102, 0.6)',
                borderColor: 'rgba(0, 204, 102, 1)',
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
                display: 'auto',
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
    let columns = ["Test Accuracy", "Test F1 Score", "Test AUC Score", "Train Accuracy", "Train F1 Score", "Train AUC Score"];
    let colToShow = ["Test Accuracy", "Test F1 Score", "Test AUC Score"];
    if (label != "all") {
        columns = ["Test Precision", "Test Recall", "Train Precision", "Train Recall"];
        colToShow = ["Test Precision", "Test Recall"];

        modelHistChart.data.datasets[6].data = metricsByLabel[label]["test_precision"];
        modelHistChart.data.datasets[7].data = metricsByLabel[label]["test_recall"];
        modelHistChart.data.datasets[8].data = metricsByLabel[label]["train_precision"];
        modelHistChart.data.datasets[9].data = metricsByLabel[label]["train_recall"];
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

$('#autoSelectBtn').on('click', () => {
    $('#spinner').removeClass("d-none");
    send_request('autoselect', {include_labels: $('#trainLabelsDropdown').val()}).then((response) => {
        $('#spinner').addClass("d-none");

        let autofeatures = response.features;
        $('#includedFeatures').children("li").each(function () {
            if (!autofeatures.includes($(this).data("elem-name"))) {
                // excluding feature
                $(this).find("button").click();
            }
        });
        $('#excludedFeatures').children("li").each(function () {
            if (autofeatures.includes($(this).data("elem-name"))) {
                // include feature
                $(this).find("button").click();
            }
        });
    });
})
/**
 * Loads the list of available features
 * Supports grouping features under parent checkboxes and allows search/filter functionality.
 */
async function fillFeatureList() {
    return send_request('list_available_features', {}).then((response) => {
        let data = response.data;
        // fillInclExcLists has a handling for updating num selected features (moveEvent function)
        fillInclExcLists(data.included_features, data.excluded_features, "#includedFeatures", "#excludedFeatures");
        updateNumSelected('#includedFeatures', '#excludedFeatures', true);
        $('#featureSearch').on('input', function () {
            const query = $(this).val().toLowerCase();

            $('#includedFeatures').children('li').each(function () {
                const featureName = $(this).data("elem-name").toLowerCase();

                if (featureName.includes(query)) {
                    $(this).removeClass('d-none');
                } else if (!$(this).hasClass('d-none')) {
                    $(this).addClass('d-none');
                }
            });

            $('#excludedFeatures').children('li').each(function () {
                const featureName = $(this).data("elem-name").toLowerCase();

                if (featureName.includes(query)) {
                    $(this).removeClass('d-none');
                } else if (!$(this).hasClass('d-none')) {
                    $(this).addClass('d-none');
                }
            });
            updateNumSelected('#includedFeatures', '#excludedFeatures', true);
        });
    });
}

$('#trainLabelsDropdown').on('change', function () {
    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-train-tab" && !avoidOnChange) {
        $('#spinner').removeClass("d-none");
        updateCorrelationMatrix().finally(() => {
            recalculateMaxCorrelation();
            $('#spinner').addClass("d-none");
        });
    }
});

async function updateCorrelationMatrix() {
    return send_request('correlation_matrix', {include_labels: $('#trainLabelsDropdown').val()}).then((response) => {
        correlationMatrix = response.data;
    });
}

function recalculateMaxCorrelation() {
    let included_features = [];
    let all_features = [];
    $('#includedFeatures').children('li').each(function () {
        included_features.push($(this).data("elem-name"));
        all_features.push($(this).data("elem-name"));
    });
    $('#excludedFeatures').children('li').each(function () {
        all_features.push($(this).data("elem-name"));
    });
    if (included_features.length < 2) {
        $(`#includedFeatures li`).css("background-color", "white");
        $(`#excludedFeatures li`).css("background-color", "white");
    } else {
        for (let feat of all_features) {
            const values = Object.entries(correlationMatrix[feat])
                .filter(([col, value]) => included_features.includes(col) && col !== feat && value !== "null")
                .map(([, value]) => value);

            let max_corr = values.length ? Math.max(...values) : null;
            if (max_corr) {
                let r, g, b = 0;

                if (max_corr < 0.5) {
                    r = Math.round(255 * (max_corr * 2));
                    g = 255;
                } else {
                    r = 255;
                    g = Math.round(255 * ((1 - max_corr) * 2));
                }

                let elem = $(`[data-elem-name="${feat}"]`);
                elem.css("background-color", `rgb(${r}, ${g}, ${b}, 0.2)`);
            }
        }
    }
}

function enableTrain() {
    avoidOnChange = true;
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
    $('#scalerSelect').prop('disabled', false);
    $('#pcaComps').prop('disabled', false);

    $('#includedFeatures button').prop('disabled', false);
    $('#excludedFeatures button').prop('disabled', false);
    $("#allToExcluded").prop('disabled', false);
    $("#allToIncluded").prop('disabled', false);
    $('#trainModelBtn').show();
    $('#modelScroll').find('button').removeClass('btn-dark');

    $('#enableTrainBtn').hide();
    avoidOnChange = false;
}

$('#applyTrain').on('click', () => {
    applyModel(applyModelPath);
})

$('#applyBest').on('click', () => {
    if (bestModel.path)
        applyModel(bestModel.path);
})

const pcaCtx = $('#pcaChart')[0].getContext('2d');
pcaChart = new Chart(pcaCtx, {
    data: {
        labels: [], // Fill this with 1, 2... dynamically
        datasets: [
            {
                type: 'bar',
                label: 'Variance Explained',
                data: [],
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            },
            {
                type: 'line',
                label: 'Cumulative Variance',
                data: [],
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                fill: false,
                hidden: true
            }
        ]
    },
    options: {
        responsive: true,
        scales: {
            x: {
                title: {
                    display: true,
                    text: 'PCA Components',
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                }
            },
        },
        plugins: {
            datalabels: {
                display: false
            }
        }
    }
});

/**
 * Ensures old and new content are not displayed simultaneously.
 */
function resetTrainView() {
    // reset state
    metricsByLabel = {};
    applyModelPath = null;
    bestModel = { test_accuracy: 0, path: null };

    enableTrain();

    $('#modelSummary').text("");
    $('#modelScroll').empty();

    $("#labelForMetrics").empty();
    $("#labelForMetrics").append($('<option value="all">All Labels</option>'));

    modelHistChart.data.labels = [];
    modelHistChart.data.datasets.forEach(dataset => dataset.data = []);
    modelHistChart.update();

    const table = $('#modelMetricsTable').DataTable();
    table.clear();
    table.draw();
}