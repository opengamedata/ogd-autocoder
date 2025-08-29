let numRejects = 0;
let numAccepts = 0;

$('#segmentDropdown_apply').select2({
    placeholder: "...",
    width: '60%',
});

$('#labelsDropdown_apply').select2({
    tags: false,
    placeholder: '...',
    width: '100%',
    templateResult: function formatOption(option) {
        let template = '<div><strong>' + option.text + '</strong></div>';
        if (option.title) {
            template += '<div>' + option.title + '</div>'
        }
        return $(template);
    }
});

$('#segmentDropdown_apply').on('change', function () {
    $('#spinner').removeClass("d-none");
    let promises = []
    promises.push(loadEvents('#applyTable', '#segmentDropdown_apply'));
    promises.push(getPredictedLabels());
    Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
});

async function getPredictedLabels() {
    await $.ajax({
        url: 'predicted_label',
        method: "POST",
        data: JSON.stringify({ 
            user_id: $('#userDropdown').val(),
            segment_id: $('#segmentDropdown_apply').val()
        }),
        contentType: "application/json",
        success: function (response) {
            $("#labelsDropdown_apply").val(response["label"]).trigger('change');
            $('#confidence').val(parseFloat(response["confidence"]).toFixed(2))
        },
        error: function (xhr, status, error) {
            console.error("Auto Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function applyModel(model_path) {
    if (!model_path) {
        alert('Hit train or select existing model before applying');
        return;
    }
    $('#nav-apply-tab').click();
    $('#spinner').removeClass("d-none");
    $.ajax({
        url: 'infere',
        method: "POST",
        data: JSON.stringify({ model_path: model_path}),
        contentType: "application/json",
        success: function (response) {
            $('#spinner').addClass("d-none");
        },
        error: function (xhr, status, error) {
            console.error("Auto Segmentation failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function acceptLabel() {
    labelRows('#applyTable', '#segmentDropdown_apply', '#labelsDropdown_apply', null);

    numAccepts++;
    $('#accept-count').text(`Accepts: ${numAccepts}`);
}

function rejectLabel() {
    nextOption('#segmentDropdown_apply');

    numRejects++;
    $('#reject-count').text(`Rejects: ${numRejects}`);
}