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
            template += '<div>' + option.title + '</div>'
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
*/
async function fillLabelDropdowns() {
    let dropdown_ids = ["#labelsDropdown", "#trainLabelsDropdown", "#labelsDropdown_apply"]

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
 * Labels rows from the selected segment.
 * Uses selected segment, labels, and optional justification to update server data,
 * then refreshes label dropdowns, label counts, and the segment dropdown for the given table.
 *
 * @param {string} seg_dropdown_id - Selector for the segment dropdown.
 * @param {string} lbl_dropdown_id - Selector for the labels dropdown.
 * @param {string|null} jus_dropdown_id - Selector for justification dropdown (optional).
 */
async function labelRows(seg_dropdown_id, lbl_dropdown_id, jus_dropdown_id = null) {
    const user_id = $('#userDropdown').val();
    if (!user_id) {
        return;
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
    return send_request(`label/${user_id}`, data).then((response) => {
        $(jus_dropdown_id).val("");
        let promises = [];
        promises.push(fillLabelDropdowns());
        promises.push(fillLabelsCount());
        // maybe instead use https://stackoverflow.com/questions/37330407/jquery-select2-change-option-text
        promises.push(fillSegmentDropdown(seg_dropdown_id, false));

        Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
    });
}

/**
 * Fetches the count of each label from the server and displays it in the format:
 * "Labels count: label1 (count), label2 (count), ..."
 */
async function fillLabelsCount() {
    return send_request('labels_value_count', {}).then((response) => {
        let text = "";
        for (let [key, value] of Object.entries(response.data)) {
            text += `${key} (${value}), `;
        }
        text = text.length > 0 ? "Labels count: " + text.substring(0, text.length - 2) : "&nbsp;";
        $("#labelsValueCount").html(text);
    });
}

function nextOption(dropdown_id) {
    const select = $(dropdown_id);
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (current + 1) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

function prevOption(dropdown_id) {
    const select = $(dropdown_id);
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (options.length + (current - 1)) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

/**
 * Loads and populates the segment dropdown for the current user
 * if reset_value = false - preserves the previously selected segment if available.
 * Once loaded, triggers load events for the segment
 *
 * @param {string} dropdown_id - Selector for the segment dropdown to fill.
 * @param {boolean} reset_value - whether to preserves previous value
 */
async function fillSegmentDropdown(dropdown_id, reset_value = true) {
    const previousValue = $(dropdown_id).val();
    $(dropdown_id).empty();
    const user_id = $('#userDropdown').val();
    if (!user_id) {
        return Promise.reject("No user selected");
    }

    $('#spinner').removeClass("d-none");
    return send_request(`list_segment_ids/${user_id}`, {}).then((response) => {
        response.data.forEach(seg => {
            let lbl = seg.segment_labels;
            let job_lbl = "";
            if (seg.job_name) {
                job_lbl = seg.job_name + " ";
            }
            
            $(dropdown_id).append(`<option value="${seg.segment_id}">${seg.segment_id} ${job_lbl}(${lbl ?? "---"})</option>`);
        });

        if (!reset_value && previousValue && $(`${dropdown_id} option[value="${previousValue}"]`).length > 0) {
            $(dropdown_id).val(previousValue);
        }

        $(dropdown_id).trigger('change');
    });
}

$('#segmentDropdown').on('change', function () {
    $('#spinner').removeClass("d-none");
    loadEvents('#labelTable', '#segmentDropdown').finally(() => {$('#spinner').addClass("d-none");});
});

$('#importLabelsBtn').on('click', function () {
    $('#importLabelsFile').click();
});

/**
 * Adds new options (replaces if exist) from the uploaded JSON codebook with this format:
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
            )
            $('#errorsModal').modal('show');
        }
    };

    reader.readAsText(file);
});

$('#editLabelsBtn').on('click', function () {
    var $form = $('#labelsEditForm');
    $form.empty();

    $('#labelsDropdown option').each(function (i, opt) {
        var $opt = $(opt);
        var label = $opt.text();
        var desc = $opt.attr('title') || '';

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

$('#saveLabels').on('click', function () {
    let dropdown_id = '#labelsDropdown';
    $(dropdown_id).empty();

    $('#labelsEditForm .label-input-group').each(function (i, row) {
        var $row = $(row);
        var label = $row.find('.label-input').val().trim();
        var desc = $row.find('.description-input').val().trim();

        $(dropdown_id).append(`<option value="${label}" title="${desc}">${label}</option>`);
    });
    
    
    $(dropdown_id).trigger('change');
    $('#editLabelsModal').modal('hide');
});
