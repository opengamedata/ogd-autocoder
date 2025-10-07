$(document).ready(function () {

    $('[data-toggle="tooltip"]').tooltip();

    $('#login_form').on('submit', (e) => {
        e.preventDefault();
        $('#login').addClass('d-none');

        let new_login = $('#login_username').val();

        $('#username_display').text(new_login);

        localStorage.setItem("login", new_login);

        // set cookie to send on each request
        document.cookie = "username=" + new_login;

        $('#logout_btn').removeClass('d-none');
    });


    if (!localStorage.getItem("login")) {
        $('#login').removeClass('d-none');
    } else {
        $('#username_display').text(localStorage.getItem("login"));
        $('#logout_btn').removeClass('d-none');

        // set cookie to send on each request
        document.cookie = "username=" + localStorage.getItem("login");
    }

    $('#logout_btn').on('click', function () {
        $('#logout_btn').addClass('d-none');
        localStorage.removeItem("login");
        $('#login').removeClass('d-none');
        $('#login_username').val('');
        $('#username_display').text('');
    });
    
});