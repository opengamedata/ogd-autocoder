let labelChart, segmentChart;
/**
 * Fills dataset information on the page, updates charts and dropdowns.
 * Fetches dataset metadata and populates various UI elements.
 *
 * @returns {Promise<void>} Resolves after dataset information and charts are populated.
 */
async function fillDatasetInfo() {
    $('#datasetInfo').removeClass('d-none');

    await send_request('dataset_info', {}).then((response) => {
        const data = response.data;
        const percentage = Math.trunc((100 * data.filtered.rows) / data.original.rows);

        $('span[data-field="date-range"]').text(data.date_range);
        $('td[data-field="rows-filtered"]').text(`${data.filtered.rows.toLocaleString()} (${percentage}%)`);
        $('td[data-field="segments-filtered"]').text(data.filtered.segments.toLocaleString());
        $('td[data-field="users-filtered"]').text(data.filtered.users.toLocaleString());
        $('td[data-field="sessions-filtered"]').text(data.filtered.sessions.toLocaleString());

        $('td[data-field="rows-original"]').text(data.original.rows.toLocaleString());
        $('td[data-field="segments-original"]').text(data.original.segments.toLocaleString());
        $('td[data-field="users-original"]').text(data.original.users.toLocaleString());
        $('td[data-field="sessions-original"]').text(data.original.sessions.toLocaleString());

        // Populate user dropdown
        const $userDropdown = $('#userDropdown').empty().append('<option></option>');
        data.users.forEach(user => {
            $userDropdown.append(
                `<option value="${user.user_id}">${user.user_id} (${user.segment_count} ${user.segment_count === 1 ? 'segment' : 'segments'})</option>`
            );
        });
        $userDropdown.trigger('change');

        // Populate event types dropdown
        const $segmentDropdown = $('#segmentEventTypeDropdown').empty();
        data.included_events.forEach(event => {
            $segmentDropdown.append(`<option value="${event.name}">${event.name}</option>`);
        });
        $segmentDropdown.show();

        // Labels distribution text
        const labelText = data.labels_distribution.length
            ? "Labels count: " + data.labels_distribution.map(l => `${l.segment_labels} (${l.count})`).join(", ")
            : "&nbsp;";
        $("#labelsValueCount").html(labelText);

        // Update charts
        fillLabelDistPie(data.labels_distribution);
        const labelSegCount = data.labels_distribution.reduce((sum, item) => sum + parseInt(item.count), 0);
        const notLabeled = data.filtered.segments - labelSegCount;
        const notSelected = data.original.segments - notLabeled - labelSegCount;
        segmentChart.data.datasets[0].data = [labelSegCount, notLabeled, notSelected];
        segmentChart.update();

        // Fill included/excluded lists
        fillInclExcLists(data.included_events, data.excluded_events, "#includedEvents", "#excludedEvents");
    });
}
/**
 * Populates the included/excluded events lists.
 *
 * @param {Array<Object>} includedElems - List of included elements.
 * @param {Array<Object>} excludedElems - List of excluded elements.
 * @param {string} includedId - Selector for the included list container.
 * @param {string} excludedId - Selector for the excluded list container.
 */
function fillInclExcLists(includedElems, excludedElems, includedId, excludedId) {
    const includedList = $(includedId).empty();
    const excludedList = $(excludedId).empty();

    includedElems.forEach(el => includedList.append(createListItem(el, true, includedId, excludedId)));
    excludedElems.forEach(el => excludedList.append(createListItem(el, false, includedId, excludedId)));

    $('[data-toggle="tooltip"]').tooltip();
    updateNumSelected('#includedEvents', '#excludedEvents', false);
}

/**
 * Increases the displayed number of models by a given value.
 *
 * @param {number} incVal - Increment value.
 */
function increaseModelsCount(incVal) {
    
    const value = parseInt($('span[data-field="models"]').text());
    $('span[data-field="models"]').text(value + incVal);
}

/**
 * Populates the label distribution pie chart.
 *
 * @param {Array<Object>} labelData - Labels distribution in this format: [{count: 1, segment_labels: 'label'}...]
 */
function fillLabelDistPie(labelData) {
    labelChart.data.datasets = [{
        data: labelData.map(d => parseInt(d.count)),
        backgroundColor: generateColors(labelData.length)
    }];
    labelChart.data.labels = labelData.map(d => d.segment_labels);
    labelChart.update();
}

/**
 * Creates a list item element for event inclusion/exclusion.
 *
 * @param {Object} element - Event object.
 * @param {boolean} included - `true` if the event goes in the included list.
 * @param {string} includedId - Selector for included list.
 * @param {string} excludedId - Selector for excluded list.
 * @returns {jQuery} The constructed list item element.
 */
function createListItem(element, included, includedId, excludedId) {
    return $(`
        <li data-elem-name="${element.name}" 
            class="list-group-item d-flex justify-content-between align-items-center" 
            data-toggle="tooltip" 
            title="${element.description ?? element.name}">
            <span>${element.name}</span>
            <button data-include="${included}" 
                    class="btn btn-sm ${included ? 'btn-outline-danger' : 'btn-outline-success'}" 
                    onclick="moveEvent(this, '${includedId}', '${excludedId}')">
                <i class="bi ${included ? 'bi-arrow-right' : 'bi-arrow-left'}"></i>
            </button>
        </li>
    `);
}

/**
 * Moves an event between included and excluded lists.
 *
 * @param {HTMLElement} button - The button element triggering the move.
 * @param {string} includedId - Selector for included list.
 * @param {string} excludedId - Selector for excluded list.
 */
function moveEvent(button, includedId, excludedId) {
    const $button = $(button);
    const $li = $button.closest('li');
    const included = $button.attr("data-include") === "true";
    const $targetList = $(included ? excludedId : includedId);

    let tooltipInstance = bootstrap.Tooltip.getInstance($li[0])
    if (tooltipInstance) {
        tooltipInstance.dispose();
    }

    $button
        .toggleClass('btn-outline-danger btn-outline-success')
        .html(`<i class="bi ${included ? 'bi-arrow-left' : 'bi-arrow-right'}"></i>`)
        .attr("data-include", !included);

    $li.appendTo($targetList);
    bootstrap.Tooltip.getOrCreateInstance($li[0]);
    // either a feature or an event_type
    const isFeature = includedId.toLowerCase().includes("features");
    updateNumSelected(includedId, excludedId, isFeature);

    if (isFeature) {
        recalculateMaxCorrelation();
    } else {
        $('#saveFilterBtn')
            .attr('disabled', false)
            .addClass('btn-outline-primary')
            .removeClass('btn-outline-secondary');
    }
}

/**
 * Updates the count of selected elements and elements matching search text in both included/excluded lists
 *
 * @param {string} includedId - Selector for included list.
 * @param {string} excludedId - Selector for excluded list.
 * @param {boolean} is_feature - Whether counting features or events.
 */
function updateNumSelected(includedId, excludedId, is_feature) {
    const suffix = is_feature ? "Feats" : "Evts";
    $("#numSel" + suffix).text($(includedId).children().length);
    $("#countFilteredIncluded" + suffix).text($(includedId).children(":visible").length);
    $("#countFilteredExcluded" + suffix).text($(excludedId).children(":visible").length);
}

/**
 * Displays a modal asking for confirmation before deleting a file.
 *
 * @param {string} selected_filename - Name of the file to delete.
 */
function showDeleteFileModal(selected_filename) {
    $('#deleteFileModal').modal('show');
    $('#deleteFileName').text(selected_filename);

    $('#deleteFileAccept').off('click').on('click', function() {
        deleteFile(selected_filename);
    });
}

/**
 * Sends a request to delete the selected dataset file and updates the UI.
 *
 * @param {string} selected_filename - Name of the file to delete.
 */
function deleteFile(selected_filename) {
    $('#deleteFileModal').modal('hide');
    $('#spinner').removeClass("d-none");
    let deletingSelected = $(`#datasetsScroll .btn-dark[data-filename="${selected_filename}"]`)
    if (deletingSelected.length) {
        // if the deleting file is the one selected
        filename = null;
        document.cookie = "";
        $('#datasetInfo').addClass("d-none");
        $('.nav-link').addClass('disabled');
        $('#labelsValueCount').html("&nbsp;");
    }

    send_request('delete_file', { filename_to_delete: selected_filename }).then(() => {
        $(`#datasetsScroll button[data-filename="${selected_filename}"]`).parent().remove();
        $('#spinner').addClass("d-none");
    });
}

/**
 * Filters dataset based on included events and refreshes the dataset view.
 */
function filterDataset() {
    $('#spinner').removeClass("d-none");
    const included_events = $("#includedEvents li").map(function() {
        return $(this).data("elem-name");
    }).get();

    send_request('dataset_filter', { included_events }).then(() => {
        onFileChange(filename, true);
    });
}

/**
 * Generates a list of distinct colors using HSL.
 *
 * @param {number} n - Number of colors to generate.
 * @returns {string[]} Array of HSL color strings.
 */
function generateColors(n) {
    return Array.from({ length: n }, (_, i) =>
        `hsl(${Math.round((360 / n) * i)}, 70%, 55%)`
    );
}

// Chart initialization
const ctxLD = $("#labelDistributionPlot")[0].getContext("2d");
Chart.register(ChartDataLabels);
labelChart = new Chart(ctxLD, {
    type: "pie",
    data: { labels: [], datasets: [] },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Labels Count" },
            datalabels: {
                color: "#fff",
                display: 'auto',
                font: { weight: "bold", size: 16 },
                formatter: value => (value > 0 ? value : "")
            }
        }
    }
});

const ctxSG = $("#segmentedLabeledDistribution")[0].getContext("2d");
Chart.register(ChartDataLabels);
segmentChart = new Chart(ctxSG, {
    type: "pie",
    data: {
        labels: ["Labeled", "Not Labeled", "Not Selected"],
        datasets: [{
            data: [null, null, null],
            backgroundColor: ["#28a745", "#dc3545", "#adb5bd"],
            hoverOffset: 4
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Labeling Progress" },
            datalabels: {
                color: "#fff",
                display: 'auto',
                font: { weight: "bold", size: 16 },
                formatter: value => (value > 0 ? value : "")
            }
        }
    }
});

// Event search handler
$('#evTypesSearch').on('input', function () {
    const query = $(this).val().toLowerCase();

    $('#includedEvents').children('li').each(function () {
        const name = $(this).data("elem-name").toLowerCase();

        if (name.includes(query)) {
            $(this).removeClass('d-none');
        } else if (!$(this).hasClass('d-none')) {
            $(this).addClass('d-none');
        }
    });

    $('#excludedEvents').children('li').each(function () {
        const name = $(this).data("elem-name").toLowerCase();

        if (name.includes(query)) {
            $(this).removeClass('d-none');
        } else if (!$(this).hasClass('d-none')) {
            $(this).addClass('d-none');
        }
    });
    updateNumSelected('#includedEvents', '#excludedEvents', false);
});