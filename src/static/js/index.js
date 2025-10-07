let filename = null; // only used for the download api
document.cookie = "filename=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

// 1. dropdowns initialization
$('#segmentEventTypeDropdown').select2({
    width: '100%',
});
$('#userDropdown').select2({
    placeholder: "Select a user",
    width: '100%',
});

// 2. tables initialization (3 similar tables)
for (let table_id of ["#labelTable", "#segmentTable", "#applyTable"]) {
    let select = table_id === "#segmentTable" ? { style: 'multi+shift' } : null;
    $(table_id).DataTable({
        select: select,
        order: [[4, 'asc']],
        paging: false,
        scrollY: '400px',
        scrollCollapse: true,
        colReorder: true,
        columnDefs: [
            { targets: [1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], visible: false },
        ],
        dom: '<"top d-flex justify-content-between align-items-center"fB>rt<"bottom"ip>',
        buttons: ['colvis'],
    });
    if (select) {
        // drag and select
        let isDragging = false;
        let table = $(table_id).DataTable();
        let $container = $(table.table().container()).find(".dt-scroll-body");
        let scrollTimer = null;

        $container.on("mousedown", "tr", function(e) {
            isDragging = true;
        });

        $(document).on("mouseup", function(e) {
            isDragging = false;
            if (scrollTimer) {
                clearInterval(scrollTimer);
                scrollTimer = null;
            }
        });

        $container.on("mouseover", "tr", function(e) {
            if (isDragging) {
                table.row(this).select();
            }
        });

        $(document).on("mousemove", function(e) {
            if (!isDragging) return;

            let offset = $container.offset();
            let top = offset.top + 100;
            let bottom = offset.top + $container.outerHeight() - 100;
        
            // Auto-scroll up/down
            if (e.pageY < top || e.pageY > bottom) {
                if (!scrollTimer) {
                    scrollTimer = setInterval(() => {
                        let value = e.pageY < top ? -20 : 20;
                        $container[0].scrollBy({ top: value, behavior: "auto" });
                    }, 100);
                }
            } else if (scrollTimer) {
                clearInterval(scrollTimer);
                scrollTimer = null;
            }
        });
    }
}

function triggerFilePicker() {
    $('#tsvFile').click();
}

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
    if (tabId == "nav-data-tab") {
        $("#user_panel").addClass("d-none");
        fillDatasetInfo();
    } else if (tabId == "nav-segment-tab") {
        $("#user_panel").removeClass("d-none");
        userChanged();
    } else if (tabId == "nav-label-tab") {
        $("#user_panel").removeClass("d-none");
        userChanged();
    } else if (tabId == "nav-review-tab") {
        $("#user_panel:not([class*='d-none'])").addClass("d-none");
        $('#spinner').removeClass("d-none");
        reloadReview().finally(() => { $('#spinner').addClass("d-none"); });
    } else if (tabId == "nav-train-tab") {
        $("#user_panel:not([class*='d-none'])").addClass("d-none");
        if (filename) {
            $('#spinner').removeClass("d-none");
            fillFeatureList().finally(() => {
                $('#spinner').addClass("d-none");
                createUnitPerLayerInputs();
                // select all labels by default
                let allValues = $('#trainLabelsDropdown option').map(function () {
                    return $(this).val();
                }).get();

                $('#trainLabelsDropdown').val(allValues).trigger('change');
            });
        }
    } else {
        // apply tab
        $("#user_panel").removeClass("d-none");
        userChanged();
    }
});

/**
 * Uploads the selected TSV file to the server via AJAX,
 * updates the `filename` global variable and cookie on success,
 */
function uploadFile() {
    const fileInput = document.getElementById('tsvFile');
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: 'upload',
        method: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function (response) {
            filename = response.filename;
            document.cookie = `filename=${filename}`;
            let newDataset = $(`<div class="d-flex align-items-center w-100 mb-2">
                <button class="btn btn-light flex-grow-1 text-start" data-filename="${response.filename}" onclick="loadExisting('${response.filename}')">${response.formatted}</button>
                <button class="btn btn-sm btn-danger ms-2" onclick="showDeleteFileModal('${response.filename}')"><i class="bi bi-trash text-white"></i></button>
            </div>`)

            $('#datasetsScroll').prepend(newDataset)

            onFileChange(filename, false);
        },
        error: function (xhr, status, error) {
            console.error("Upload failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

/**
 * Loads an existing file (no uploading),
 * sets the filename and cookie
 *
 * @param {string} existing_filename - name of the selected file form the dropdown
 */
function loadExisting(existing_filename) {
    filename = existing_filename;
    document.cookie = `filename=${existing_filename}`;
    $('#spinner').removeClass("d-none");
    onFileChange(existing_filename, true);
}

/**
 * Handles logic when file is switched (to existing or new)
 * Populates users list, event types, labels count, and optionally models list.
 *
 * @param {boolean} load_models - to avoid loading models for newly uploaded files
 */
function onFileChange(filename, load_models) {
    $('span[data-field="filename"]').text(filename);
    $('#datasetsScroll').find('.btn-light').removeClass('btn-dark');
    $(`#datasetsScroll .btn-light[data-filename="${filename}"]`).addClass('btn-dark');
    $('#saveFilterBtn').attr('disabled', true);
    $('#saveFilterBtn').removeClass('btn-outline-primary').addClass('btn-outline-secondary');

    let promises = [fillDatasetInfo()];
    resetTrainView();
    resetApplyView();
    $('span[data-field="models"]').text(0);
    if (load_models) {
        promises.push(fillModelsList());
    }

    Promise.all(promises)
        .then(() => {
            const tabId = $('#nav-tab .nav-link.active').attr('id');
            fillLabelDropdowns();
            for (let table_id of ["#labelTable", "#segmentTable", "#applyTable"]) {
                const table = $(table_id).DataTable();
                table.clear();
                table.draw();
            }

            $('.nav-link.disabled').removeClass('disabled'); // enable navigation
            $('#trainModelBtn').show();
            $('#applyTrain').show();
            $('#applyBest').show();
            $('#autoSegmentBtn').prop("disabled", false);
            $('#segmentEventTypeDropdown').prop("disabled", false);
            $('#spinner').addClass("d-none");
        }).catch((err) => {
            console.error("Error loading existing file:", err);
        });
}

/**
 * Populates the #userDropdown with the list of users (display user_id with number of segments)
 * if reset_value = false - preserves the previously selected user if available.
 * 
 *  * @param {boolean} reset_value - whether to preserves previous value
 */
async function fillUsersList(reset_value = true) {
    const previousValue = $('#userDropdown').val();
    $('#userDropdown').empty().append('<option></option>');
    await send_request('users_list', {}).then((response) => {
        response.users.forEach(user => {
            $('#userDropdown').append(`<option value="${user.user_id}">${user.user_id} (${user.segment_count} ${user.segment_count == 1 ? "segment" : "segments"})</option>`);
        });

        if (!reset_value && previousValue && $(`#userDropdown option[value="${previousValue}"]`).length > 0) {
            $('#userDropdown').val(previousValue);
        }

        $('#userDropdown').trigger('change')
    });
}

function userChanged() {
    let select = $('#userDropdown');
    const options = select.find('option');
    const current = select.prop('selectedIndex');

    if (current == options.length - 1 || select.val() == null) {
        $('#lblNxtUsr').prop('disabled', true);
        $('#aplNxtUsr').prop('disabled', true);
    } else {
        $('#lblNxtUsr').prop('disabled', false);
        $('#aplNxtUsr').prop('disabled', false);
    }

    if (current <= 1 || select.val() == null) {
        $('#lblPreUsr').prop('disabled', true);
        $('#aplPreUsr').prop('disabled', true);
    } else {
        $('#lblPreUsr').prop('disabled', false);
        $('#aplPreUsr').prop('disabled', false);
    }

    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-segment-tab") {
        $('#spinner').removeClass("d-none");
        loadEvents("#segmentTable", null).finally(() => { $('#spinner').addClass("d-none"); });
    } else if (tabId == "nav-label-tab") {
        $('#spinner').removeClass("d-none");
        fillSegmentDropdown('#segmentDropdown').finally(() => { $('#spinner').addClass("d-none"); });
    } else if (tabId == "nav-apply-tab") {
        $('#spinner').removeClass("d-none");
        let promises = []
        promises.push(fillSegmentDropdown('#segmentDropdown_apply'));
        promises.push(getPredictedLabels());
        Promise.all(promises).finally(() => { $('#spinner').addClass("d-none"); });
    }
}

/**
 * Populates table with event data for a specific user and optionally a segment,
 * then populates the given DataTable with the returned data.
 *
 * @param {string} table_id - Selector for the target DataTable (e.g., "#segmentTable").
 * @param {string|null} seg_dropdown_id - Selector for the segment dropdown (null for segment tab).
 */
async function loadEvents(table_id, seg_dropdown_id) {
    const table = $(table_id).DataTable();
    table.clear();

    let segment_id = null;
    if (["#labelTable", "#applyTable"].includes(table_id)) {
        segment_id = $(seg_dropdown_id).val()
        if (!segment_id) {
            table.draw();
            return;
        }
    }

    const user_id = $('#userDropdown').val();
    if (!user_id) {
        table.draw();
        return;
    }
    await send_request(`events/${user_id}`, {segment_id}).then((response) => {
        response.data.forEach(row => {
            const values = [
                row.index,
                row.event_name,
                row.event_description,
                row.job_name,
                row.timestamp,
                row.segment_id,
                row.segment_labels,
                row.label_justification,
                row.session_id,
                row.app_id,
                row.event_data,
                row.event_source,
                row.app_version,
                row.app_branch,
                row.log_version,
                row.offset,
                row.user_id,
                row.user_data,
                row.game_state
            ].map(v => v ?? '-'); // in case there are null values
            table.row.add(values);
        });

        table.draw();
    });
}

$("#describeEventsBtn").click(function() {
    $("#eventDescriptionsFile").click();
});

/**
 * Adds description using dictionary {event_name: event_description}, e.g.:
 * {
 *  "switch_job": "Switched from job A to job B",
 *  "complete_task": "Completed task 1 within job A"
 * }
*/
$('#eventDescriptionsFile').on('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const mapping = JSON.parse(e.target.result);
            send_request('update_event_descriptions', {"descriptions_map": mapping});
        } catch (err) {
            $('#errorsModalBody').text(
                'Invalid JSON file, please check the format, e.g. {"switch_job": "Switched from job A to job B", "complete_task": "Completed task 1 within job A"}.'
            )
            $('#errorsModal').modal('show');
        }
    };

    reader.readAsText(file);
});
