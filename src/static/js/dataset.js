/**
 * Populates the dataset info
 */
async function fillDatasetInfo() {
    $('#datasetInfo').removeClass('d-none');

    await $.ajax({
        url: '/dataset_info',
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

            fillEventLists(data.included_events, data.excluded_events)
        },
        error: function (xhr, status, error) {
            console.error("User list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}



function fillEventLists(includedEvents, excludedEvents) {
    const includedList = $("#includedEvents").empty();
    const excludedList = $("#excludedEvents").empty();

    includedEvents.forEach(eventName => {
        includedList.append(createListItem(eventName, true));
    });

    excludedEvents.forEach(eventName => {
        excludedList.append(createListItem(eventName, false));
    });
}

function createListItem(eventName, included) {
    const li = $(`
        <li data-event-name="${eventName}" class="list-group-item d-flex justify-content-between align-items-center">
            ${eventName}
            <button data-include="${included}" class="btn btn-sm ${included ? 'btn-outline-danger' : 'btn-outline-success'}" 
                    onclick="moveEvent(this)">
                <i class="bi ${included ? 'bi-arrow-right' : 'bi-arrow-left'}"></i>
            </button>
        </li>
    `);
    return li;
}

function moveEvent(button) {
    let $button = $(button);
    var $li = $button.closest('li');
    var included = $button.attr("data-include") === "true";
    var $targetList = $("#" + (included ? "excludedEvents" : "includedEvents"));

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
}

function filterDataset() {
    $('#spinner').removeClass("d-none");
    const included_events = $("#includedEvents li").map(function() {
        return $(this).data("event-name");
    }).get();

    $.ajax({
        url: "/dataset_filter",
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