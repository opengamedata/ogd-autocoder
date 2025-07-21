let table = null;
let filename = null;
let next_segment_id = null;
function triggerFilePicker() {
    document.getElementById('tsvFile').click();
}

document.getElementById('tsvFile').addEventListener('change', function () {
    if (this.files.length > 0) {
        uploadFile();
    }
});

function colorConsecutiveJobs() {
    const colors = ['#ffffff', '#f0f8ff']; // white and light blue (or choose your own)
    let colorIndex = 0;
    let lastJobName = null;

    $('#eventsTable tbody tr').each(function () {
    const jobName = $(this).find('td').eq(2).text().trim(); // 3rd column: Job Name

    if (jobName !== lastJobName) {
        colorIndex = 1 - colorIndex; // toggle between 0 and 1
        lastJobName = jobName;
    }

    $(this).css('background-color', colors[colorIndex]);
    });
}

function uploadFile() {
    const fileInput = document.getElementById('tsvFile');
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append("file", file);

    $.ajax({
        url: "/upload",
        method: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function(response) {
            filename = response.filename;
            $('#userDropdown').empty().append('<option></option>');
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
            $('#eventsTableDiv').hide();
        },
        error: function(xhr, status, error) {
            console.error("Upload failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function loadEvents() {
    const user_id = $('#userDropdown').val();
    $.ajax({
        url: `/events/${user_id}`,
        method: "POST",
        data: JSON.stringify({ filename: filename }),
        contentType: "application/json",
        success: function(response) {

            next_segment_id = response.max_segment_id + 1;
            $("#segmentIdDisplay").text(next_segment_id);
            
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
            colorConsecutiveJobs();
            $('#eventsTableDiv').show();
        },
        error: function(xhr, status, error) {
            console.error("Event data load failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function segmentRows() {
    const user_id = $('#userDropdown').val();
    const selectedRows = table.rows({ selected: true }).data().toArray();
    if (selectedRows.length == 0) {
        alert("Please, select at least one row!")
    }
    $.ajax({
        url: `/segmentation/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({ 
            filename: filename,
            selected_rows: selectedRows.map(row => [row[0], row[3]]),
            segment_id: next_segment_id,
            segment_labels: $('#segmentLabelsInput').val()
        }),
        contentType: "application/json",
        success: function(response) {
            // update next id and reload data
            next_segment_id += 1;
            $("#segmentIdDisplay").text(next_segment_id);

            loadEvents();
        },
        error: function(xhr, status, error) {
            console.error("Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });

    document.getElementById('downloadBtn').addEventListener('click', function () {
        const url = `/download?file=${encodeURIComponent(filename)}`;

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;  // Optional: hint to browser
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}