let tables = {};
let filename = null;

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
    if (["nav-segment-tab", "nav-label-tab"].includes(tabId)) {
        $("#load_and_user_panel").removeClass("d-none");
        userChanged();
    } else {
        // https://stackoverflow.com/questions/8266662/add-class-via-jquery-but-only-when-not-exists
        $("#load_and_user_panel:not([class*='d-none'])").addClass("d-none")
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
    $('#autoSegmentBtn').hide();
    $('#userDropdown').empty().append('<option></option>');
    //const fileSizeMB = file.size / (1024 * 1024);
    //let estimatedTime = 0.042 * fileSizeMB + 1.79; // linear regression made from 2 points :)
    $.ajax({
        url: "/upload",
        method: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function(response) {
            $('#spinner').addClass("d-none");
            filename = response.filename;
            response.user_ids.forEach(user_id => {
                $('#userDropdown').append(`<option value="${user_id}">${user_id}</option>`);
            });

            // Initialize or reinitialize Select2
            $('#userDropdown').select2({
                placeholder: "Select a user",
                width: '100%',
            });

            $('#userDropdown').show();
            $('#downloadBtn').show();
            $('#trainModelBtn').show();
        },
        error: function(xhr, status, error) {
            console.error("Upload failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}
function nextSegment() {
    const select = $('#segmentDropdown');
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (current + 1) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

function prevSegment() {
    const select = $('#segmentDropdown');
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (options.length + (current - 1)) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

function userChanged() {
    const tabId = $('#nav-tab .nav-link.active').attr('id');
    if (tabId == "nav-segment-tab") {
        loadEvents("#segmentTable");
    } else if (tabId == "nav-label-tab") {
        $('#segmentDropdown').empty();
        $('#segmentDropdown').select2({
            placeholder: "Select a segment",
            width: '40%',
        });
        const user_id = $('#userDropdown').val();
        if (user_id) {
            $('#spinner').removeClass("d-none");
            $.ajax({
                url: `/list_segment_ids/${user_id}`,
                method: "POST",
                data: JSON.stringify({filename: filename}),
                contentType: "application/json",
                success: function(response) {
                    response.data.forEach(seg_id => {
                        $('#segmentDropdown').append(`<option value="${seg_id}">${seg_id}</option>`);
                    });
                    $('#spinner').addClass("d-none");

                    const segment_id = $('#segmentDropdown').val();
                    loadEvents("#labelTable", segment_id);
                },
                error: function(xhr, status, error) {
                    console.error("Upload failed:", status, error);
                    console.log("Server response:", xhr.responseText);
                }
            });
        }

        
    }
}


function loadEvents(table_id) {
    // table_id: #segmentTable | #labelTable
    let segment_id = null;
    if (table_id == "#labelTable") {
        segment_id = $('#segmentDropdown').val()
        if (!segment_id) return; // needs a segment_id
    }

    const user_id = $('#userDropdown').val();
    if (!user_id) return;

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/events/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename, segment_id: segment_id }),
        contentType: "application/json",
        success: function(response) {
            let data = response.data;
            if (tables[table_id]) {
                tables[table_id].destroy();
                $(`${table_id} tbody`).empty();
            }

            data.forEach(row => {
            $(`${table_id} tbody`).append(
                `<tr>
                <td>${row.index}</td>
                <td>${row.event_name}</td>
                <td>${row.job_name}</td>
                <td>${row.timestamp}</td>
                <td>${row.segment_id}</td>
                <td>${row.segment_labels}</td>
                <td>${row.label_justification}</td>
                </tr>`
            );
            });
            tables[table_id] = $(table_id).DataTable({
                select: { style: 'multi' },
                order: [[3, 'asc']],
                paging: false,
                scrollY: '400px',
                scrollCollapse: true
            });

            $('#spinner').addClass("d-none");
            $('#autoSegmentBtn').show();
        },
        error: function(xhr, status, error) {
            console.error("Event data load failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function segmentRows() {
    let table_id = "#segmentTable";
    const user_id = $('#userDropdown').val();
    const selectedRows = tables[table_id].rows({ selected: true }).data().toArray();
    if (selectedRows.length == 0) {
        alert("Please, select at least one row!")
        return;
    }
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/segment/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({ 
            filename: filename,
            selected_rows: selectedRows.map(row => [row[0], row[3]]),
            segment_id: $("#segmentIdInput").val(),
        }),
        contentType: "application/json",
        success: function(response) {
            // autoincrement
            let next_segment_id = parseInt($("#segmentIdInput").val()) + 1
            $("#segmentIdInput").val(next_segment_id);
    
            // reload data
            loadEvents(table_id);
        },
        error: function(xhr, status, error) {
            console.error("Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function labelRows() {
    let table_id = "#labelTable";
    const user_id = $('#userDropdown').val();
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/label/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({ 
            filename: filename,
            segment_id: $("#segmentDropdown").val(),
            segment_labels: $('#segmentLabelsInput').val(),
            label_justification: $('#labelJustificationInput').val()
        }),
        contentType: "application/json",
        success: function(response) {    
            // reload data
            loadEvents(table_id);
        },
        error: function(xhr, status, error) {
            console.error("Labeling failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function autoSegment() {
    // hide modal
    bootstrap.Modal.getInstance($('#confirmSegmentModal')[0]).hide();

    const user_id = $('#userDropdown').val();
    let table_id = "#segmentTable"

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/autosegment/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename,}),
        contentType: "application/json",
        success: function(response) {
            // reload data
            loadEvents(table_id);
        },
        error: function(xhr, status, error) {
            console.error("Auto Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function trainModel() {
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/train_model`,
        method: "POST",
        data: JSON.stringify({ filename: filename,}),
        contentType: "application/json",
        success: function(response) {
            $('#spinner').addClass("d-none");
            $('#modelSummary').text(response["output"]);
        },
        error: function(xhr, status, error) {
            console.error("Model Training failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}