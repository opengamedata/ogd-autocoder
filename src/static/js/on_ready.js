$(document).ready(function () {

    $('[data-toggle="tooltip"]').tooltip();

    $('#login_form').on('submit', (e) => {
        e.preventDefault();
        $('#login').addClass('d-none');

        const new_login = $('#login_username').val();

        $('#username_display').text(new_login);
        localStorage.setItem("login", new_login);

        // Set cookie to send username on each request
        document.cookie = "username=" + new_login;

        $('#logout_btn').removeClass('d-none');
    });

    if (!localStorage.getItem("login")) {
        $('#login').removeClass('d-none');
    } else {
        const saved_login = localStorage.getItem("login");
        $('#username_display').text(saved_login);
        $('#logout_btn').removeClass('d-none');

        // set cookie to send on each request
        document.cookie = "username=" + saved_login;
    }

    $('#logout_btn').on('click', function () {
        $('#logout_btn').addClass('d-none');
        localStorage.removeItem("login");
        $('#login').removeClass('d-none');
        $('#login_username').val('');
        $('#username_display').text('');
    });
});