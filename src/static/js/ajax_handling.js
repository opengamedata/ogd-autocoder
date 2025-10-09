/**
 * Sends an asynchronous HTTP request and shows an error modal if the request fails.
 *
 * @param {string} url - The request URL.
 * @param {Object} raw_data_object - The request data object (not JSON-stringified).
 * @returns {Promise<Response>} A promise that resolves with the fetch response.
 */
async function send_request(url, raw_data_object) {
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