document.addEventListener("DOMContentLoaded", async ()=>{


    const token =
    localStorage.getItem("session_token");


    const authBtn =
    document.getElementById("auth-btn");


    if(!token){

        if(authBtn){

            authBtn.textContent =
            "ورود / ثبت‌نام";

            authBtn.href =
            "login.html";

        }

        return;

    }



    try{


        const result =
        await apiCall(
            "check-session",
            {
                token
            }
        );



        if(result.valid){


            authBtn.textContent =
            "داشبورد من";


            authBtn.href =
            "dashboard.html";


        }
        else{


            localStorage.removeItem(
                "session_token"
            );


            authBtn.textContent =
            "ورود / ثبت‌نام";


            authBtn.href =
            "login.html";


        }


    }
    catch(error){

        console.error(error);


    }


});