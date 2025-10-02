let numRejects = 0;
let numAccepts = 0;

$('#segmentDropdown_apply').select2({
    placeholder: "...",
    width: '100%',
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
    let data = { 
        user_id: $('#userDropdown').val(),
        segment_id: $('#segmentDropdown_apply').val()
    }
    await send_request('predicted_label', data).then((response) => {
        $("#labelsDropdown_apply").val(response["label"].split(", ")).trigger('change');
        $('#confidence').val(parseFloat(response["confidence"]).toFixed(2))
    })
}

function applyModel(model_path) {
    if (!model_path) {
        $('#errorsModalBody').text('Hit train or select existing model before applying')
        $('#errorsModal').modal('show');
        return;
    }

    $('#spinner').removeClass("d-none");
    send_request('infere', {model_path: model_path}).then((response) => {
        $('#spinner').addClass("d-none");
        $('#nav-apply-tab').click();
    })
}

function acceptLabel() {
    labelRows('#segmentDropdown_apply', '#labelsDropdown_apply', null).then((response) => {
        numAccepts++;
        $('#accept-count').text(`Accepts: ${numAccepts}`);
    })
}

function rejectLabel() {
    nextOption('#segmentDropdown_apply');

    numRejects++;
    $('#reject-count').text(`Rejects: ${numRejects}`);
}

function resetApplyView() {
    numAccepts = 0;
    numRejects = 0;
    $('#accept-count').text(`Accepts: ${numAccepts}`);
    $('#reject-count').text(`Rejects: ${numRejects}`);
}