let filename = null;
document.cookie = "filename=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

$('#segmentEventTypeDropdown').select2();
$('#userDropdown').select2({
    placeholder: "Select a user",
    width: '100%',
});

// order models by timestamp
$('#modelMetricsTable').DataTable({
    order: [[1, 'asc']],
    paging: false,
    scrollY: '400px',
    scrollCollapse: true
});

for (let table_id of ["#labelTable", "#segmentTable"]) {
    $(table_id).DataTable({
        select: { style: 'multi' },
        order: [[3, 'asc']],
        paging: false,
        scrollY: '400px',
        scrollCollapse: true,
        colReorder: true,
        columnDefs: [
            { targets: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], visible: false },
        ],
        dom: '<"top d-flex justify-content-between align-items-center"fB>rt<"bottom"ip>',
        buttons: ['colvis'],
    });
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
    if (tabId == "nav-segment-tab") {
        $("#load_and_user_panel").removeClass("d-none");
        userChanged();
    } else if (tabId == "nav-label-tab") {
        $("#load_and_user_panel").removeClass("d-none");
        if (filename) {
            fillLabelDropdown("#labelsDropdown");
        }
        userChanged();
    } else if (tabId == "nav-train-tab") {
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none"); // https://stackoverflow.com/questions/8266662/add-class-via-jquery-but-only-when-not-exists
        if (filename) {
            fillFeatureList();
            createUnitPerLayerInputs();
            fillLabelDropdown("#trainLabelsDropdown").then(() => {
                // select all labels by default
                let allValues = $('#trainLabelsDropdown option').map(function() {
                    return $(this).val();
                }).get();

                $('#trainLabelsDropdown').val(allValues).trigger('change');
            });
        }
    } else {
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none");
    }
});

function triggerFilePicker() {
    $('#tsvFile').click();
}

function uploadFile() {
    const fileInput = document.getElementById('tsvFile');
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);

    $('#spinner').removeClass("d-none");
    //const fileSizeMB = file.size / (1024 * 1024);
    //let estimatedTime = 0.042 * fileSizeMB + 1.79; // linear regression made from 2 points :)
    $.ajax({
        url: "/upload",
        method: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function (response) {
            filename = response.filename;
            document.cookie = `filename=${filename}`;
            on_file_change(false);
        },
        error: function (xhr, status, error) {
            console.error("Upload failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function load_existing(existing_filename) {
    filename = existing_filename;
    document.cookie = `filename=${filename}`;
    $('#spinner').removeClass("d-none");
    on_file_change(true);
}

function on_file_change(load_models) {
    let promises = [fill_users_list(), fill_event_types(), fillLabelsCount()];
    if (load_models) {
        promises.push(fill_models_list());
    }

    Promise.all(promises)
    .then(() => {
        const tabId = $('#nav-tab .nav-link.active').attr('id');
        if (tabId == "nav-label-tab")
            fillLabelDropdown("#labelsDropdown");
        else if (tabId == "nav-train-tab")
            fillLabelDropdown("#trainLabelsDropdown");
        
        const table1 = $('#segmentTable').DataTable();
        table1.clear();
        table1.draw();
        const table2 = $('#labelTable').DataTable();
        table2.clear();
        table2.draw();
        
        $('#downloadBtn').show();
        $('#trainModelBtn').show();
        $('#autoSegmentBtn').prop("disabled", false);
        $('#segmentEventTypeDropdown').prop("disabled", false);
        $('#spinner').addClass("d-none");
    }).catch((err) => {
        console.error("Error loading existing file:", err);
    });
}

async function fill_users_list() {
    const previousValue = $('#userDropdown').val();
    $('#userDropdown').empty().append('<option></option>');
    await $.ajax({
        url: '/users_list',
        method: "POST",
        contentType: "application/json",
        success: function (response) {
            response.users.forEach(user => {
                $('#userDropdown').append(`<option value="${user.user_id}">${user.user_id} (${user.segment_count} ${user.segment_count == 1 ? "segment" : "segments"})</option>`);
            });

            if (previousValue && $(`#userDropdown option[value="${previousValue}"]`).length > 0) {
                $('#userDropdown').val(previousValue);
            }

            $('#userDropdown').trigger('change').show();
        },
        error: function (xhr, status, error) {
            console.error("User list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function userChanged() {
    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-segment-tab") {
        $('#spinner').removeClass("d-none");
        loadEvents("#segmentTable").finally(() => {$('#spinner').addClass("d-none");});
    } else if (tabId == "nav-label-tab") {
        fillSegmentDropdown();
    }
}

async function loadEvents(table_id) {
    // table_id: #segmentTable | #labelTable
    const table = $(table_id).DataTable();
    table.clear();
    
    let segment_id = null;
    if (table_id == "#labelTable") {
        segment_id = $('#segmentDropdown').val()

        // needs a segment_id
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

    await $.ajax({
        url: `/events/${user_id}`,
        method: "POST",
        data: JSON.stringify({ segment_id: segment_id }),
        contentType: "application/json",
        success: function (response) {
            let data = response.data;

            data.forEach(row => {
                table.row.add([
                    row.index,
                    row.event_name,
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
                ]);
            });

            table.draw();
        },
        error: function (xhr, status, error) {
            console.error("Event data load failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}