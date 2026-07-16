const phoneInput =
document.getElementById("phone");


const passwordInput =
document.getElementById("password");


const loginBtn =
document.getElementById("login-btn");


const message =
document.getElementById("message");






async function checkExistingSession(){


    const token =
    localStorage.getItem(
        "session_token"
    );


    if(!token)
        return;



    try{


        const result =
        await apiCall(
            "check-session",
            {
                token
            }
        );



        if(result.valid){


            window.location.href =
            "dashboard.html";


        }
        else{


            localStorage.removeItem(
                "session_token"
            );

        }



    }
    catch(error){

        console.error(error);

    }


}









function showMessage(
    text,
    type="normal"
){


    message.className =
    "text-center text-sm mt-5";



    if(type==="success"){


        message.classList.add(
            "text-green-600"
        );


    }
    else if(type==="error"){


        message.classList.add(
            "text-red-600"
        );


    }
    else{


        message.classList.add(
            "text-gray-500"
        );


    }



    message.innerText =
    text;


}









function validatePhone(phone){


    phone =
    phone.trim();



    return /^09\d{9}$/.test(phone);


}









loginBtn.addEventListener(
"click",
async()=>{



    const phone =
    phoneInput.value.trim();



    const password =
    passwordInput.value;



    if(!phone || !password){


        showMessage(
            "شماره موبایل و رمز عبور را وارد کنید",
            "error"
        );


        return;

    }




    if(!validatePhone(phone)){


        showMessage(
            "شماره موبایل صحیح نیست",
            "error"
        );


        return;

    }




    if(password.length < 4){


        showMessage(
            "رمز عبور کوتاه است",
            "error"
        );


        return;

    }





    loginBtn.disabled = true;


    loginBtn.innerText =
    "در حال ورود...";



    showMessage(
        "در حال بررسی اطلاعات..."
    );





    try{



        const result =
        await apiCall(
            "login-user",
            {
                phone,
                password
            }
        );





        if(!result.success){



            showMessage(
                result.error ||
                "ورود ناموفق بود",
                "error"
            );


            return;

        }





        // ذخیره توکن

        localStorage.setItem(
            "session_token",
            result.token
        );





        // فقط برای نمایش UI
        // امنیت به آن وابسته نیست

        localStorage.setItem(
            "user",
            JSON.stringify(
                result.user
            )
        );






        showMessage(
            "ورود موفق",
            "success"
        );







        const user =
        result.user;





        setTimeout(()=>{





            if(
                !user.first_name ||
                !user.last_name ||
                !user.grade ||
                !user.major
            ){


                window.location.href =
                "complete-profile.html";


            }
            else{


                window.location.href =
                "dashboard.html";


            }



        },500);







    }
    catch(error){



        console.error(error);



        showMessage(
            "خطا در ارتباط با سرور",
            "error"
        );



    }
    finally{



        loginBtn.disabled = false;



        loginBtn.innerText =
        "ورود";


    }



});







// با Enter وارد شود

document.addEventListener(
"keydown",
(e)=>{


    if(e.key==="Enter"){


        loginBtn.click();


    }


});






checkExistingSession();


