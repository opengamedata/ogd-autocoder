let table = null;
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

function triggerFilePicker() {
    $('#tsvFile').click();
}

function uploadFile() {
    const fileInput = document.getElementById('tsvFile');
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);

    $('#spinner').removeClass("d-none");
    $('#eventsTableDiv').hide();
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
                allowClear: true
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

function loadEvents() {
    const user_id = $('#userDropdown').val();
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/events/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function(response) {
            let data = response.data;
            if (table) {
                table.destroy();
                $('#eventsTable tbody').empty();
            }

            data.forEach(row => {
            $('#eventsTable tbody').append(
                `<tr>
                <td>${row.index}</td>
                <td>${row.event_name}</td>
                <td>${row.job_name}</td>
                <td>${row.timestamp}</td>
                <td>${row.segment_id}</td>
                <td>${row.segment_labels}</td>
                </tr>`
            );
            });
        
            table = $('#eventsTable').DataTable({
                select: { style: 'multi' },
                order: [[3, 'asc']],
                paging: false,
                scrollY: '400px',
                scrollCollapse: true
            });

            $('#spinner').addClass("d-none");
            $('#autoSegmentBtn').show();
            $('#eventsTableDiv').show();

            if ($("#segmentIdInput").val() == "") {
                $("#segmentIdInput").val(1);
            }
        },
        error: function(xhr, status, error) {
            console.error("Event data load failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

/**
 * Update rows column based on upd_id_instead_label param (if true -> update segment id, otherwise -> update labels)
 */
function updateRows(upd_id_instead_label) {
    const user_id = $('#userDropdown').val();
    const selectedRows = table.rows({ selected: true }).data().toArray();
    if (selectedRows.length == 0) {
        alert("Please, select at least one row!")
        return;
    }
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/update/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({ 
            filename: filename,
            selected_rows: selectedRows.map(row => [row[0], row[3]]),
            upd_id_instead_label: upd_id_instead_label,
            segment_id: $("#segmentIdInput").val(),
            segment_labels: $('#segmentLabelsInput').val()
        }),
        contentType: "application/json",
        success: function(response) {
            if (upd_id_instead_label) {
                // autoincrement
                let next_segment_id = parseInt($("#segmentIdInput").val()) + 1
                $("#segmentIdInput").val(next_segment_id);
            }
        
            // reload data
            loadEvents();
        },
        error: function(xhr, status, error) {
            console.error("Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function autoSegment() {
    // hide modal
    bootstrap.Modal.getInstance($('#confirmSegmentModal')[0]).hide();

    const user_id = $('#userDropdown').val();

    $('#spinner').removeClass("d-none");
    $.ajax({
        url: `/autosegment/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename,}),
        contentType: "application/json",
        success: function(response) {
            // reload data
            loadEvents();
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
            alert(response["output"]);
        },
        error: function(xhr, status, error) {
            console.error("Model Training failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}