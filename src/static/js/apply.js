let numRejects = 0;
let numAccepts = 0;

$('#applyUserDropdown').select2({
    placeholder: "Select a user",
    width: '100%',
});

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

    const options = $(this).find('option');
    const current = $(this).prop('selectedIndex');

    $('#aplNxtSgm').prop('disabled', (current == options.length - 1 || $(this).val() == null));
    $('#aplPreSgm').prop('disabled', (current == 0 || $(this).val() == null));

    let promises = []
    promises.push(loadEvents('#applyTable', '#applyUserDropdown', '#segmentDropdown_apply'));
    promises.push(getPredictedLabels());
    Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
});

async function getPredictedLabels() {
    let data = { 
        user_id: $('#applyUserDropdown').val(),
        segment_id: $('#segmentDropdown_apply').val()
    }
    await send_request('predicted_label', data).then((response) => {
        $("#labelsDropdown_apply").val(response["label"]).trigger('change');
        let confidence = parseFloat(response["confidence"]).toFixed(2);
        $('#confidence').val(confidence == "NaN" ? "-" : confidence)
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
    const user_id = $('#applyUserDropdown').val();
    if (!user_id) {
        return Promise.reject("No user selected");
    }

    let selectedSegment = $('#segmentDropdown_apply').val();
    let selectedLabels = $('#labelsDropdown_apply').val().join(', ');
    let data = {
        segment_id: selectedSegment,
        segment_labels: selectedLabels,
    };

    $('#spinner').removeClass("d-none");
    return send_request(`label/${user_id}`, data).then((response) => {
        let promises = [];
        let nextSegment = null;
        let nextUser = $('#applyUserDropdown').val();
        if (!$('#aplNxtSgm').prop('disabled')) {
            nextOption('#segmentDropdown_apply', true);
            nextSegment = $('#segmentDropdown_apply').val();
        } else if (!$('#aplNxtUsr').prop('disabled')) {
            nextOption('#applyUserDropdown', true);
            nextUser = $('#applyUserDropdown').val();
        }

        // maybe instead use https://stackoverflow.com/questions/37330407/jquery-select2-change-option-text
        $('#segmentDropdown_apply').data('value-after-update', nextSegment);
        $('#applyUserDropdown').data('value-after-update', nextUser);

        let confidenceThd = parseFloat($('#confidenceThd').val());
        promises.push(fillUsersList('#applyUserDropdown', true, confidenceThd));
        promises.push(fillLabelsCount());

        Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});

        numAccepts++;
        $('#accept-count').text(`Accepts: ${numAccepts}`);
    });
}

function reloadConfidenceChanged () {
    $('#spinner').removeClass("d-none");
    let confidenceThd = parseFloat($('#confidenceThd').val());

    fillUsersList('#applyUserDropdown', true, confidenceThd).finally(() => {$('#spinner').addClass("d-none");});
}

function rejectLabel() {
    if (!$('#aplNxtSgm').prop('disabled')) {
        nextOption('#segmentDropdown_apply');
    } else if (!$('#aplNxtUsr').prop('disabled')) {
        nextOption('#applyUserDropdown');
    }

    numRejects++;
    $('#reject-count').text(`Rejects: ${numRejects}`);
}

function resetApplyView() {
    numAccepts = 0;
    numRejects = 0;
    $('#accept-count').text(`Accepts: ${numAccepts}`);
    $('#reject-count').text(`Rejects: ${numRejects}`);
}