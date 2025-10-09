// some functions are also used in the Apply tab

$('#segmentDropdown').select2({
    placeholder: "...",
    width: '100%',
});

$('#labelsDropdown').select2({
    tags: true,
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

/**
 * Populates label dropdowns
 * (`#labelsDropdown`, `#trainLabelsDropdown`, `#labelsDropdown_apply`)
 * with all existing labels from the file.
 *
 * Clears all labels except the ones from codebook,
 * then appends the received data without duplicating
 * 
 * @returns {Promise<void>} Resolves when dropdowns are populated.
 */
async function fillLabelDropdowns() {
    let dropdown_ids = ["#labelsDropdown", "#trainLabelsDropdown", "#labelsDropdown_apply"];

    for (let dropdown_id of dropdown_ids) {
        // don't remove the uploaded options from codebook.csv
        $(dropdown_id).val("");
        $(dropdown_id).children(':not([title])').remove();
    }

    $('#spinner').removeClass("d-none");
    return send_request('list_labels', {}).then((response) => {
        for (let dropdown_id of dropdown_ids) {
            response.data.forEach(label => {
                if ($(`${dropdown_id} option[value="${label}"]`).length === 0) {
                    // don't repeat codebook options
                    $(dropdown_id).append(`<option value="${label}">${label}</option>`);
                }
                $(dropdown_id).trigger('change');
            });
        }
        $('#spinner').addClass("d-none");
    });
}

/**
 * Labels rows for the selected segment.
 * Uses the selected segment, labels, and optional justification to update server data.
 * Refreshes label dropdowns, counts, and segment dropdowns for the current user/table.
 *
 * @param {string} user_dropdown_id - Selector for the user dropdown.
 * @param {string} seg_dropdown_id - Selector for the segment dropdown.
 * @param {string} lbl_dropdown_id - Selector for the labels dropdown.
 * @param {string|null} jus_dropdown_id - Selector for justification dropdown (optional).
 * @returns {Promise<void>} Resolves after label update and UI refresh.
 */
async function labelRows(user_dropdown_id, seg_dropdown_id, lbl_dropdown_id, jus_dropdown_id = null) {
    const user_id = $(user_dropdown_id).val();
    if (!user_id) {
        return Promise.reject("No user selected");
    }

    let selectedSegment = $(seg_dropdown_id).val();
    let selectedLabels = $(lbl_dropdown_id).val().join(', ');
    let justification = jus_dropdown_id ? $(jus_dropdown_id).val() : null;
    let data = {
        segment_id: selectedSegment,
        segment_labels: selectedLabels,
        label_justification: justification
    };
    $('#spinner').removeClass("d-none");
    return send_request(`label/${user_id}`, data).then(() => {
        $(jus_dropdown_id).val("");
        $(seg_dropdown_id).data('value-after-update', selectedSegment);
        let promises = [
            fillLabelDropdowns(),
            fillLabelsCount(),
            fillSegmentDropdown(seg_dropdown_id)
        ];

        // Store current value for re-selection after reload

        Promise.all(promises).finally(() => { $('#spinner').addClass("d-none"); });
    });
}

/**
 * Fetches the count of each label from the server and displays it in the format:
 * "Labels count: label1 (count), label2 (count), ..."
 */
async function fillLabelsCount() {
    return send_request('labels_value_count', {}).then((response) => {
        let text = "";
        response.data.forEach(label => {
            text += `${label.segment_labels} (${label.count}), `;
        });
        text = text.length > 0 ? "Labels count: " + text.slice(0, -2) : "&nbsp;";
        $("#labelsValueCount").html(text);
    });
}

/**
 * Selects the next option in a dropdown.
 *
 * @param {string} dropdown_id - The selector for the dropdown element.
 * @param {boolean} [silently=false] - If true, selection change won't trigger events.
 */
function nextOption(dropdown_id, silently = false) {
    const select = $(dropdown_id);
    const next = select.prop('selectedIndex') + 1;
    select.prop('selectedIndex', next);

    if (!silently) select.trigger('change');
}

/**
 * Selects the previous option in a dropdown.
 *
 * @param {string} dropdown_id - The selector for the dropdown element.
 * @param {boolean} [silently=false] - If true, selection change won't trigger events.
 */
function prevOption(dropdown_id, silently = false) {
    const select = $(dropdown_id);
    const prev = select.prop('selectedIndex') - 1;
    select.prop('selectedIndex', prev);

    if (!silently) select.trigger('change');
}

/**
 * Loads and populates the segment dropdown for the current user.
 * Once loaded, triggers a `change` event for the segment.
 *
 * If `data-value-after-update` is set, that value is restored after update.
 * Otherwise, clears the dropdown selection.
 *
 * @param {string} dropdown_id - Selector for the segment dropdown.
 * @param {boolean} [unlabeled_only=false] - Whether to show only unlabeled segments.
 * @param {?number} [confidence_threshold=null] - Optional confidence threshold filter.
 * @returns {Promise<void>} Resolves when the dropdown is filled and updated.
 */
async function fillSegmentDropdown(dropdown_id, unlabeled_only = false, confidence_threshold = null) {
    $(dropdown_id).empty();
    const user_id = unlabeled_only ? $('#applyUserDropdown').val() : $('#userDropdown').val();
    if (!user_id) {
        return Promise.reject("No user selected");
    }

    $('#spinner').removeClass("d-none");
    return send_request(`list_segment_ids/${user_id}`, {
        unlabeled_only: unlabeled_only,
        confidence_threshold: confidence_threshold
    }).then((response) => {
        response.data.forEach(seg => {
            let lbl = seg.segment_labels;
            if (seg.job_name) {
                lbl = lbl ? `${seg.job_name}, ${lbl}` : seg.job_name;
            }
            $(dropdown_id).append(`<option value="${seg.segment_id}">${seg.segment_id} (${lbl ?? "---"})</option>`);
        });

        if ($(dropdown_id).data('value-after-update')) {
            $(dropdown_id).val($(dropdown_id).data('value-after-update'));
            $(dropdown_id).removeData('value-after-update');
        }

        $(dropdown_id).trigger('change');
    });
}

$('#segmentDropdown').on('change', function () {
    $('#spinner').removeClass("d-none");

    const options = $(this).find('option');
    const current = $(this).prop('selectedIndex');
    $('#lblNxtSgm').prop('disabled', current === options.length - 1 || $(this).val() == null);
    $('#lblPreSgm').prop('disabled', current === 0 || $(this).val() == null);

    loadEvents('#labelTable', '#userDropdown', '#segmentDropdown').finally(() => {
        $('#spinner').addClass("d-none");
    });
});

$('#importLabelsBtn').on('click', function () {
    $('#importLabelsFile').click();
});

/**
 * Handles label codebook JSON import.
 * Replaces or adds new label options to `#labelsDropdown` using uploaded file content.
 *
 * Expected file format:
 * [
 *   {"code": "Struggle", "definition": "..."},
 *   {"code": "No Struggle", "definition": "..."}
 * ]
 */
$('#importLabelsFile').on('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const rows = JSON.parse(e.target.result);
            const $dropdown = $('#labelsDropdown');

            $.each(rows, function (i, row) {
                $dropdown.find(`option[value="${row.code}"]`).remove();
                if (row.code && row.definition) {
                    const $option = $('<option>')
                        .val(row.code)
                        .text(row.code)
                        .attr('title', row.definition);
                    $dropdown.append($option);
                }
            });
        } catch (err) {
            $('#errorsModalBody').text(
                'Invalid JSON file, please check the format, e.g. {"code": "struggle", "definition": "player does not understand sth"}.'
            );
            $('#errorsModal').modal('show');
        }
    };

    reader.readAsText(file);
});

$('#editLabelsBtn').on('click', function () {
    const $form = $('#labelsEditForm');
    $form.empty();

    $('#labelsDropdown option').each(function (_, opt) {
        const $opt = $(opt);
        const label = $opt.text();
        const desc = $opt.attr('title') || '';

        $form.append(`
            <div class="mb-2">
                <div class="label-input-group border rounded p-2">
                    <input type="text" class="label-input form-control mb-2" value="${label}" readonly style="background-color: #f8f9fa; border: 1px solid #ced4da;">
                    <input type="text" class="description-input form-control" value="${desc}" placeholder="Description" style="border: 1px solid #ced4da;">
                </div>
            </div>
        `);
    });

    $('#editLabelsModal').modal('show');
});

/**
 * Saves edited label definitions from the modal into the dropdown.
 * Updates label options with new titles (descriptions) and triggers UI update.
 */
$('#saveLabels').on('click', function () {
    const dropdown_id = '#labelsDropdown';
    $(dropdown_id).empty();

    $('#labelsEditForm .label-input-group').each(function (_, row) {
        const $row = $(row);
        const label = $row.find('.label-input').val().trim();
        const desc = $row.find('.description-input').val().trim();

        $(dropdown_id).append(`<option value="${label}" title="${desc}">${label}</option>`);
    });

    $(dropdown_id).trigger('change');
    $('#editLabelsModal').modal('hide');
});
