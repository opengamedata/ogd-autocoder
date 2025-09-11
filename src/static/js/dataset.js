let labelChart, segmentChart;

/**
 * Populates the dataset info
 */
async function fillDatasetInfo() {
    $('#datasetInfo').removeClass('d-none');

    await $.ajax({
        url: 'dataset_info',
        method: "POST",
        contentType: "application/json",
        success: function (response) {
            let data = response.data;
            let percentage = Math.trunc(100 * data.filtered.rows / data.original.rows, 2)

            $('span[data-field="date-range"]').text(data.date_range);
            $('span[data-field="models"]').text(data.models_count);

            $('td[data-field="rows-filtered"]').text(data.filtered.rows.toLocaleString() + " (" + percentage + " %)");
            $('td[data-field="segments-filtered"]').text(data.filtered.segments.toLocaleString());
            $('td[data-field="users-filtered"]').text(data.filtered.users.toLocaleString());
            $('td[data-field="sessions-filtered"]').text(data.filtered.sessions.toLocaleString());

            $('td[data-field="rows-original"]').text(data.original.rows.toLocaleString());
            $('td[data-field="segments-original"]').text(data.original.segments.toLocaleString());
            $('td[data-field="users-original"]').text(data.original.users.toLocaleString());
            $('td[data-field="sessions-original"]').text(data.original.sessions.toLocaleString());

            // fillUsersList
            $('#userDropdown').empty().append('<option></option>');
            data.users.forEach(user => {
                $('#userDropdown').append(`<option value="${user.user_id}">${user.user_id} (${user.segment_count} ${user.segment_count == 1 ? "segment" : "segments"})</option>`);
            });
            $('#userDropdown').trigger('change');

            // fillEventTypes
            $('#segmentEventTypeDropdown').empty();
            data.events_types.forEach(event_type => {
                $('#segmentEventTypeDropdown').append(`<option value="${event_type}">${event_type}</option>`);
            });
            $('#segmentEventTypeDropdown').show();

            // fillLabelsCount
            let text = "";
            data.labels_distribution.forEach(label => {
                text += `${label.segment_labels} (${label.count}), `;
            });
            text = text.length > 0 ? "Labels count: " + text.substring(0, text.length - 2) : "&nbsp;";
            $("#labelsValueCount").html(text);

            fillLabelDistPie(data.labels_distribution);
            let labelSegCount = data.labels_distribution.reduce((sum, item) => sum + parseInt(item.count), 0);
            let notLabeled = data.filtered.segments - labelSegCount;
            let notSelected = data.original.segments - notLabeled - labelSegCount;
            // labels are ["Labeled", "Not Labeled", "Not Selected"]
            segmentChart.data.datasets[0].data = [labelSegCount, notLabeled, notSelected];
            segmentChart.update();
            fillInclExcLists(data.included_events, data.excluded_events, "#includedEvents", "#excludedEvents")
        },
        error: function (xhr, status, error) {
            console.error("User list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}



function fillInclExcLists(includedElems, excludedElems, includedId, excludedId) {
    const includedList = $(includedId).empty();
    const excludedList = $(excludedId).empty();

    includedElems.forEach(el => {
        includedList.append(createListItem(el, true, includedId, excludedId));
    });

    excludedElems.forEach(el => {
        excludedList.append(createListItem(el, false, includedId, excludedId));
    });
    $('[data-toggle="tooltip"]').tooltip();
}

function fillLabelDistPie(labelData) {
    labelChart.data.datasets = [{
        data: labelData.map(d => parseInt(d.count)),
        backgroundColor: generateColors(labelData.length)
    }];
    labelChart.data.labels = labelData.map(d => d.segment_labels);
    labelChart.update();
}

function createListItem(element, included, includedId, excludedId) {
    const li = $(`
        <li data-event-name="${element.name}" class="list-group-item d-flex justify-content-between align-items-center" data-toggle="tooltip" title="${element.description ?? element.name}">
            <span>${element.name}</span>
            <button data-include="${included}" class="btn btn-sm ${included ? 'btn-outline-danger' : 'btn-outline-success'}" 
                    onclick="moveEvent(this, '${includedId}', '${excludedId}')">
                <i class="bi ${included ? 'bi-arrow-right' : 'bi-arrow-left'}"></i>
            </button>
        </li>
    `);
    return li;
}

function moveEvent(button, includedId, excludedId) {
    let $button = $(button);
    var $li = $button.closest('li');
    var included = $button.attr("data-include") === "true";
    var $targetList = $(included ? excludedId : includedId);

    let tooltipInstance = bootstrap.Tooltip.getInstance($li[0])
    if (tooltipInstance) {
        tooltipInstance.dispose();
    }

    if (included) {
        $button
            .removeClass()
            .addClass('btn btn-sm btn-outline-success')
            .html('<i class="bi bi-arrow-left"></i>');
    } else {
        $button
            .removeClass()
            .addClass('btn btn-sm btn-outline-danger')
            .html('<i class="bi bi-arrow-right"></i>');
    }

    $button.attr("data-include", !included);
    $li.appendTo($targetList);
    bootstrap.Tooltip.getOrCreateInstance($li[0]);

    if (includedId.toLowerCase().includes("features"))
        updateNumSelectedFeatures();
        recalculateMaxCorrelation();
}

function filterDataset() {
    $('#spinner').removeClass("d-none");
    const included_events = $("#includedEvents li").map(function() {
        return $(this).data("event-name");
    }).get();

    $.ajax({
        url: 'dataset_filter',
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({ 
            included_events: included_events
        }),
        success: function (response) {
            onFileChange(filename, true);
        },
        error: function (xhr, status, error) {
            console.error("Filtering failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function generateColors(n) {
    // Generate colors automatically
    return Array.from({ length: n }, (_, i) =>
        `hsl(${Math.round((360 / n) * i)}, 70%, 55%)`
    );
}

const ctxLD = $("#labelDistributionPlot")[0].getContext("2d");
Chart.register(ChartDataLabels);

labelChart = new Chart(ctxLD, {
    type: "pie",
    data: {
        labels: [],
        datasets: []
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Labels Count" },
            datalabels: {
                color: "#fff",
                font: { weight: "bold", size: 16 },
                formatter: function (value) {
                    return value > 0 ? value : "";
                }
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
            hoverOffset: 4,
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: "top" },
            title: { display: true, text: "Labeled Segments" },
            datalabels: {
                color: "#fff",
                font: { weight: "bold", size: 16 },
                formatter: function (value) {
                    return value > 0 ? value : "";
                }
            }
        }
    }
});