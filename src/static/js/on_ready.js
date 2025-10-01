$(document).ready(function () {

    $('[data-toggle="tooltip"]').tooltip();

    if (!localStorage.getItem("login")) {
        $('#login').removeClass('d-none');

        $('#login_form').on('submit', (e) => {
            e.preventDefault();
            $('#login').addClass('d-none');

            let new_login = $('#login_username').val();

            $('#username_display').text(new_login);

            localStorage.setItem("login", new_login);

            // set cookie to send on each request
            document.cookie = "username=" + new_login;
        });
    } else {
        $('#username_display').text(localStorage.getItem("login"));

        // set cookie to send on each request
        document.cookie = "username=" + localStorage.getItem("login");
    }
    
});