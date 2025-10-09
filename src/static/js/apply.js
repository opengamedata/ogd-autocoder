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
            template += '<div>' + option.title + '</div>';
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

    let promises = [];
    promises.push(loadEvents('#applyTable', '#applyUserDropdown', '#segmentDropdown_apply'));
    promises.push(getPredictedLabels());
    Promise.all(promises).finally(() => { $('#spinner').addClass("d-none"); });
});

/**
 * Fetches predicted labels for the selected user and segment, then updates the label dropdown and confidence.
 *
 * @returns {Promise<void>} Resolves after predicted labels are loaded and UI is updated.
 */
async function getPredictedLabels() {
    let data = {
        user_id: $('#applyUserDropdown').val(),
        segment_id: $('#segmentDropdown_apply').val()
    };
    await send_request('predicted_label', data).then((response) => {
        $("#labelsDropdown_apply").val(response["label"]).trigger('change');
        let confidence = parseFloat(response["confidence"]).toFixed(2);
        $('#confidence').val(confidence == "NaN" ? "-" : confidence);
    });
}

/**
 * Applies a trained model to generate predictions.
 *
 * @param {string} model_path - The path to the trained model.
 * @returns {void}
 */
function applyModel(model_path) {
    if (!model_path) {
        $('#errorsModalBody').text('Hit train or select existing model before applying');
        $('#errorsModal').modal('show');
        return;
    }

    $('#spinner').removeClass("d-none");
    send_request('infere', { model_path: model_path }).then((response) => {
        $('#spinner').addClass("d-none");
        $('#nav-apply-tab').click();
    });
}

/**
 * Assigns the predicted label to the segment, and advances to the next segment or user.
 * Increments count of accepted labels.
 *
 * @returns {Promise<void>} Resolves after the label is accepted and UI is updated.
 */
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

        $('#segmentDropdown_apply').data('value-after-update', nextSegment);
        $('#applyUserDropdown').data('value-after-update', nextUser);

        let confidenceThd = parseFloat($('#confidenceThd').val());
        promises.push(fillUsersList('#applyUserDropdown', true, confidenceThd));
        promises.push(fillLabelsCount());

        Promise.all(promises).finally(() => { $('#spinner').addClass("d-none"); });

        numAccepts++;
        $('#accept-count').text(`Accepts: ${numAccepts}`);
    });
}

/**
 * Reloads the user list using new confidence.
 *
 * @returns {void}
 */
function reloadConfidenceChanged() {
    $('#spinner').removeClass("d-none");
    let confidenceThd = parseFloat($('#confidenceThd').val());

    fillUsersList('#applyUserDropdown', true, confidenceThd).finally(() => {
        $('#spinner').addClass("d-none");
    });
}

/**
 * Moves to the next segment or user and increments rejects count.
 *
 * @returns {void}
 */
function rejectLabel() {
    
    if (!$('#aplNxtSgm').prop('disabled')) {
        nextOption('#segmentDropdown_apply');
    } else if (!$('#aplNxtUsr').prop('disabled')) {
        nextOption('#applyUserDropdown');
    }

    numRejects++;
    $('#reject-count').text(`Rejects: ${numRejects}`);
}

/**
 * Resets the apply view by clearing accept/reject counters.
 *
 * @returns {void}
 */
function resetApplyView() {
    numAccepts = 0;
    numRejects = 0;
    $('#accept-count').text(`Accepts: ${numAccepts}`);
    $('#reject-count').text(`Rejects: ${numRejects}`);
}