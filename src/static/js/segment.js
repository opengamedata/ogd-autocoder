/**
 * Update segment id for the selected rows in the #segmentTable for the current user.
 * Uses the index and timestamp column to identify the selected rows
 */
function segmentRows() {
    let table_id = "#segmentTable";
    const user_id = $('#userDropdown').val();
    const selectedRows = $(table_id).DataTable().rows({ selected: true }).data().toArray();
    if (selectedRows.length == 0) {
        $('#errorsModalBody').text('Please, select at least one row!');
        $('#errorsModal').modal('show');
        return;
    }
    let data = {
        selected_rows: selectedRows.map(row => [row[0], row[8]]), // index + session_id as row_id
        segment_id: $("#segmentIdInput").val(),
    }
    $('#spinner').removeClass("d-none");
    send_request(`segment/${user_id}`, data).then((response) => {
        // autoincrement
        let next_segment_id = parseInt($("#segmentIdInput").val()) + 1
        $("#segmentIdInput").val(next_segment_id);
        let promises = [];
        $('#userDropdown').data('value-after-update', $('#userDropdown').val());
        promises.push(fillUsersList('#userDropdown', false));
        promises.push(fillLabelsCount());

        Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
    });
}

/**
 * Automatically segments events based on selected cutoff event types.
 */
function autoSegment() {
    // hide modal
    bootstrap.Modal.getInstance($('#confirmSegmentModal')[0]).hide();

    $('#spinner').removeClass("d-none");
    send_request('autosegment', {sep_event_types: $('#segmentEventTypeDropdown').val()}).then((response) => {
        let promises = [];
        $('#userDropdown').data('value-after-update', $('#userDropdown').val());
        promises.push(fillUsersList('#userDropdown', false));
        promises.push(fillLabelsCount());

        Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
    });
}