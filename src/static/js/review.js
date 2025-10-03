$('#reviewTable').on('click', '.open-segment-btn', function() {
    // the view button
    let user_id = $(this).data('user-id');
    let segment_id = $(this).data('segment-id');

    $('#userDropdown').val(user_id).trigger('change');
    $('#segmentDropdown').data('value-after-update', segment_id);
    $('#nav-label-tab').click();
});

async function loadReviewTable() {
    /**
     * Loads the labels of all the usernames to measure inter-rater reliability
     */
    
    return send_request('compare_labels', {}).then((response) => {
        if (response.data.length) {
            let username = localStorage.getItem('login');
            let columns = [
                {title: 'user_id', data: 'user_id', className: 'dt-left', width: '80px'},
                {title: 'segment_id', data: 'segment_id', className: 'dt-left', width: '80px'},
                {
                    title: 'view',
                    data: null,
                    width: '60px',
                    className: 'dt-center',
                    sortable: false,
                    render: function (data, type, row) {
                        return `
                            <button class="btn btn-sm btn-outline-primary open-segment-btn" data-user-id="${row.user_id}" data-segment-id="${row.segment_id}">
                                <i class="bi bi-journal-text"></i>
                            </button>`;
                    }
                },
                {title: username, data: username},
            ]
            Object.keys(response.data[0]).forEach(key => {
                if (!['segment_id', username, 'user_id'].includes(key)) {
                    columns.push({
                        title: key,
                        data: key
                    });
                }
            });
            let table;
            if (!$.fn.DataTable.isDataTable('#reviewTable')) {
                table = $('#reviewTable').DataTable({
                    data: response.data,
                    columns: columns,
                    order: [[0, 'asc'], [1, 'asc']],
                    paging: false,
                    scrollY: '400px',
                    scrollCollapse: true,
                    dom: '<"top d-flex justify-content-between align-items-center"fB>rt<"bottom"ip>',
                    buttons: ['colvis'],
                    rowCallback: function(row, data, index) {
                        let currentLabel = data[username];
                        if (currentLabel != "-") {
                            $(row).find('td').each(function() {
                                if ($(this).text() != "-" && $(this).text() != currentLabel && $(this).index() > 3) {
                                    $(this).css('background-color', '#f44747');
                                }
                            });
                        }
                    }                    
                });
            } else {
                table = $('#reviewTable').DataTable();
                table.clear();
                table.rows.add(response.data);
            }
            table.draw();
        }
    });
}