$('#segmentDropdown_apply').select2({
    placeholder: "...",
    width: '40%',
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
    loadEvents('#applyTable', '#segmentDropdown_apply').finally(() => {$('#spinner').addClass("d-none");});
});