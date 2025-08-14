// some functions are also used in the Apply tab

$('#segmentDropdown').select2({
    placeholder: "...",
    width: '40%',
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
    await $.ajax({
        url: "/list_labels",
        method: "POST",
        contentType: "application/json",
        success: function (response) {
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
        },
        error: function (xhr, status, error) {
            console.error("Label options loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

/**
 * Labels rows from the selected segment.
 * Uses selected segment, labels, and optional justification to update server data,
 * then refreshes label dropdowns, label counts, and the segment dropdown for the given table.
 *
 * @param {string} table_id - Target DataTable selector.
 * @param {string} seg_dropdown_id - Selector for the segment dropdown.
 * @param {string} lbl_dropdown_id - Selector for the labels dropdown.
 * @param {string|null} jus_dropdown_id - Selector for justification dropdown (optional).
 */
function labelRows(table_id, seg_dropdown_id, lbl_dropdown_id, jus_dropdown_id = null) {
    const user_id = $('#userDropdown').val();
    if (!user_id) {
        return;
    }

    $('#spinner').removeClass("d-none");
    let selectedSegment = $(seg_dropdown_id).val();
    let selectedLabels = $(lbl_dropdown_id).val().join(', ');
    let justification = jus_dropdown_id ? $(jus_dropdown_id).val() : null;
    $.ajax({
        url: `/label/${user_id}`,
        method: "POST",
        // select the index and the time column (will be the row identifier)
        data: JSON.stringify({
            segment_id: selectedSegment,
            segment_labels: selectedLabels,
            label_justification: justification
        }),
        contentType: "application/json",
        success: function (response) {
            $(jus_dropdown_id).val("")
            let promises = [];
            promises.push(fillLabelDropdowns());
            promises.push(fillLabelsCount());
            // maybe instead use https://stackoverflow.com/questions/37330407/jquery-select2-change-option-text
            promises.push(fillSegmentDropdown(table_id, seg_dropdown_id, false));

            Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
        },
        error: function (xhr, status, error) {
            console.error("Labeling failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

/**
 * Fetches the count of each label from the server and displays it in the format:
 * "Labels count: label1 (count), label2 (count), ..."
 */
async function fillLabelsCount() {
    await $.ajax({
        url: '/labels_value_count',
        method: "POST",
        success: function (response) {
            let text = "";
            response.data.forEach(label => {
                text += `${label.segment_labels} (${label.count}), `;
            });
            text = text.length > 0 ? "Labels count: " + text.substring(0, text.length - 2) : "";
            $("#labelsValueCount").text(text);
        },
        error: function (xhr, status, error) {
            console.error("User list loading failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

function nextSegment(dropdown_id) {
    const select = $(dropdown_id);
    const options = select.find('option');
    const current = select.prop('selectedIndex');
    const next = (current + 1) % options.length;

    select.prop('selectedIndex', next).trigger('change');
}

function prevSegment(dropdown_id) {
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
 * @param {string} table_id - Selector for the DataTable to update after loading.
 * @param {string} dropdown_id - Selector for the segment dropdown to fill.
 * @param {boolean} reset_value - whether to preserves previous value
 */
async function fillSegmentDropdown(table_id, dropdown_id, reset_value = true) {
    const previousValue = $(dropdown_id).val();
    $(dropdown_id).empty();
    const user_id = $('#userDropdown').val();
    if (user_id) {
        $('#spinner').removeClass("d-none");
        await $.ajax({
            url: `/list_segment_ids/${user_id}`,
            method: "POST",
            success: async function (response) {
                response.data.forEach(seg => {
                    let lbl = seg.segment_labels ? "(" + seg.segment_labels + ")" : "---";
                    $(dropdown_id).append(`<option value="${seg.segment_id}">${seg.segment_id} ${lbl}</option>`);
                });

                if (!reset_value && previousValue && $(`${dropdown_id} option[value="${previousValue}"]`).length > 0) {
                    $(dropdown_id).val(previousValue);
                }

                $(dropdown_id).trigger('change');
                await loadEvents(table_id, dropdown_id)
            },
            error: function (xhr, status, error) {
                console.error("Segment options loading failed:", status, error);
                console.log("Server response:", xhr.responseText);
            }
        });
    }
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
            alert('Invalid JSON file, please check the format, e.g. {"code": "struggle", "definition": "player does not understand sth"}.');
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
