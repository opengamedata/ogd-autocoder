/**
 * Update segment id for the selected rows in the #segmentTable for the current user.
 * Uses the index and timestamp column to identify the selected rows
 */
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
        // select the index and the session column (will be the row identifier)
        data: JSON.stringify({
            selected_rows: selectedRows.map(row => [row[0], row[8]]),
            segment_id: $("#segmentIdInput").val(),
        }),
        contentType: "application/json",
        success: function (response) {
            // autoincrement
            let next_segment_id = parseInt($("#segmentIdInput").val()) + 1
            $("#segmentIdInput").val(next_segment_id);
            let promises = [];
            promises.push(fillUsersList(false));
            promises.push(fillLabelsCount());

            Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
        },
        error: function (xhr, status, error) {
            console.error("Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

/**
 * Automatically segments events based on selected cutoff event types.
 */
function autoSegment() {
    // hide modal
    bootstrap.Modal.getInstance($('#confirmSegmentModal')[0]).hide();

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: 'autosegment',
        method: "POST",
        data: JSON.stringify({ sep_event_types: $('#segmentEventTypeDropdown').val()}),
        contentType: "application/json",
        success: function (response) {
            let promises = [];
            promises.push(fillUsersList(false));
            promises.push(fillLabelsCount());

            Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
        },
        error: function (xhr, status, error) {
            console.error("Auto Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

/**
 * Populates #segmentEventTypeDropdown with the list of event types.
 */
async function fillEventTypes() {
    $('#segmentEventTypeDropdown').empty();
    await $.ajax({
        url: 'event_types_list',
        method: "POST",
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