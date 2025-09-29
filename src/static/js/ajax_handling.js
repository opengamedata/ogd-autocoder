async function send_request(url, raw_data_object) {
    /**
     * General wrapper to send an ajax request and show the errors modal if it fails
     * @param {string} url - request url
     * @param {Object} raw_data_object - NOT jsonified request data
     */
    let deferred = $.Deferred();

    $.ajax({
        url: url,
        method: "POST",
        data: JSON.stringify(raw_data_object),
        contentType: "application/json",
        success: function (response) {
            if (response["error"]) {
                $('#spinner').addClass("d-none");
                $('#errorsModalBody').text(response["error"])
                $('#errorsModal').modal('show');
                deferred.reject(new Error(response["error"]));
            } else {
                deferred.resolve(response);
            }
        },
        error: function (xhr, status, error) {
            $('#spinner').addClass("d-none");
            console.error(url + " failed:", status, error);
            console.log("Server response:", xhr.responseText);
            deferred.reject(error);
        }
    });

    return deferred;
}