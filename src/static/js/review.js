$('#reviewTable').on('click', '.open-segment-btn', function() {
    // the view button
    let user_id = $(this).data('user-id');
    let segment_id = $(this).data('segment-id');

    $('#userDropdown').val(user_id).trigger('change');
    $('#segmentDropdown').data('value-after-update', segment_id);
    $('#nav-label-tab').click();
});

async function copyColumn(from_username) {
    const selectedRows = $('#reviewTable').DataTable().rows({ selected: true }).data().toArray();
    let ids = selectedRows.map(row => row["user_id"] + "_" + row["segment_id"]);
    ids = ids.length == 0 ? null : ids;
    if (ids == null) {
        $('#copyLabelsUser').text(from_username);
        $('#confirmCopyBtn').off('click').on('click', () => {
            send_request('copy_labels', {"from_username": from_username, "ids": ids}).then((response) => {
                $('#spinner').removeClass("d-none");
                $('#copyLabelsModal').modal('hide');
                reloadReview().finally(() => {$('#spinner').addClass("d-none");});
            });
        });
        $('#copyLabelsModal').modal('show');

        return;
    }

    $('#spinner').removeClass("d-none");
    return send_request('copy_labels', {"from_username": from_username, "ids": ids}).then((response) => {
        reloadReview().finally(() => {$('#spinner').addClass("d-none");});
    });
}


async function reloadReview() {
    promises = [loadReviewTableData(), loadKappa()];
    return Promise.all(promises);
}

async function loadKappa() {
    /**
     * Loads the pairwise (cohen) and overall (fleiss) kappa coefs for aggreagated inter-rater reliability
     */
    return send_request('inter_rater_reliability', {}).then((response) => {
        $('#kappaList').empty();
        for (let row of response.data) {
            if (row.users == "overall") {
                $('#fleissCoef').text(`${row.value.toFixed(3)} (nulls: ${row.dropped})`)
            } else {
                $('#kappaList').append(
                    $('<li>').html(`<strong>${row.users}</strong>: ${row.value.toFixed(3)} (nulls: ${row.dropped})`)
                );
            }
        }
    });
}

async function loadReviewTableData() {
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
                            <button class="btn btn-sm btn-outline-dark open-segment-btn" data-user-id="${row.user_id}" data-segment-id="${row.segment_id}">
                                <i class="bi bi-journal-text"></i>
                            </button>`;
                    }
                },
                {title: username, data: username},
            ]
            Object.keys(response.data[0]).forEach(key => {
                if (!['segment_id', username, 'user_id'].includes(key)) {
                    columns.push({
                        title: `<div class="d-flex align-items-center">
                            <span>${key}</span>
                            <button onclick="copyColumn('${key}')" class="copyBtn btn btn-sm btn-primary ms-auto">
                                <i class="bi bi-copy" title="Copy"></i>
                            </button>
                        </div>`,
                        data: key,
                        sortable: false
                    });
                }
            });
            let table;
            if (!$.fn.DataTable.isDataTable('#reviewTable')) {
                table = $('#reviewTable').DataTable({
                    data: response.data,
                    columns: columns,
                    select: { style: 'multi' },
                    order: [[0, 'asc'], [1, 'asc']],
                    paging: false,
                    scrollY: '400px',
                    scrollCollapse: true,
                    dom: '<"top d-flex justify-content-between align-items-center"fB>rt<"bottom"ip>',
                    buttons: ['colvis'],
                    rowCallback: function(row, data, index) {
                        let missing = false;
                        let disagreement = false;
                        let currentLabel = null;
                        for (let key in data) {
                            if (!["user_id", "segment_id"].includes(key)) {
                                // key is the username
                                if (data[key] == "-") {
                                    missing = true;
                                } else if (currentLabel != null && data[key] != currentLabel) {
                                    disagreement = true;
                                } else if (currentLabel == null) {
                                    currentLabel = data[key];
                                }
                            }
                        }

                        if (disagreement) {
                            // first priority
                            $(row).find('td').each(function() {
                                $(this).css('background-color', '#f44747');
                            });
                        } else if (missing) {
                            $(row).find('td').each(function() {
                                $(this).css('background-color', '#f0f0f0');
                            });
                        }
                    }
                });
            } else {
                table = $('#reviewTable').DataTable();
                table.order([[0, 'asc'], [1, 'asc']]).draw();
                table.clear();
                table.rows.add(response.data);
            }
            table.draw();
        }
    });
}