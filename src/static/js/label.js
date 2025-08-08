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
                    if ($(`${dropdown_id} option[value="${label}"]`).length === 0) { // don't repeat codebook options
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

function labelRows(table_id, seg_dropdown_id, lbl_dropdown_id, jus_dropdown_id) {
    const user_id = $('#userDropdown').val();
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
            // reload data
            $(jus_dropdown_id).val("")
            let promises = [];
            promises.push(fillLabelDropdowns());
            promises.push(fillLabelsCount());
            promises.push(fillSegmentDropdown(table_id, seg_dropdown_id));

            Promise.all(promises).finally(() => {$('#spinner').addClass("d-none");});
        },
        error: function (xhr, status, error) {
            console.error("Labeling failed:", status, error);
            console.log("Server response:", xhr.responseText);
        }
    });
}

async function fillLabelsCount() {
    await $.ajax({
        url: '/labels_value_count',
        method: "POST",
        success: function (response) {
            let text = "";
            response.data.forEach(label => {
                text += `${label.segment_labels} (${label.count}), `;
            });
            text = text.length > 0 ? "Labels count: " + text.substring(0, text.length - 2) : ""; // remove last comma
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

async function fillSegmentDropdown(table_id, dropdown_id) {
    const previousValue = $(dropdown_id).val();
    $(dropdown_id).empty();
    const user_id = $('#userDropdown').val();
    if (user_id) {
        $('#spinner').removeClass("d-none");
        await $.ajax({
            url: `/list_segment_ids/${user_id}`,
            method: "POST",
            success: function (response) {
                response.data.forEach(seg => {
                    let lbl = seg.segment_labels ? "(" + seg.segment_labels + ")" : "---";
                    $(dropdown_id).append(`<option value="${seg.segment_id}">${seg.segment_id} ${lbl}</option>`);
                });

                if (previousValue && $(`${dropdown_id} option[value="${previousValue}"]`).length > 0) {
                    $(dropdown_id).val(previousValue);
                }

                $(dropdown_id).trigger('change');
                loadEvents(table_id, dropdown_id).finally(() => {$('#spinner').addClass("d-none");});
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