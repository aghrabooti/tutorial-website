const phoneInput =
document.getElementById("phone");

const passwordInput =
document.getElementById("password");

const otpInput =
document.getElementById("otp");

const sendOtpBtn =
document.getElementById("send-otp-btn");

const registerBtn =
document.getElementById("register-btn");

const message =
document.getElementById("message");





function showMessage(text, success=false){

    message.innerText = text;

    message.className = success
    ?
    "text-center text-sm mt-5 text-green-600"
    :
    "text-center text-sm mt-5 text-red-600";

}







// ارسال OTP

sendOtpBtn.addEventListener(
"click",
async()=>{


    const phone =
    phoneInput.value.trim();



    if(!phone){

        showMessage(
            "شماره موبایل را وارد کنید"
        );

        return;

    }



    sendOtpBtn.disabled = true;



    showMessage(
        "در حال ارسال کد..."
    );



    try{


        const result =
        await apiCall(
            "send-otp",
            {
                phone
            }
        );



        console.log(result);



        if(result.success){


            showMessage(
                "کد تایید ساخته شد",
                true
            );



            otpInput
            .parentElement
            .classList
            .remove("hidden");


            registerBtn
            .classList
            .remove("hidden");



            // فقط برای تست
            if(result.debug_code){

                console.log(
                    "OTP TEST:",
                    result.debug_code
                );

            }


        }
        else{


            showMessage(
                result.error ||
                "خطا در ارسال OTP"
            );


        }



    }
    catch(error){


        console.error(error);


        showMessage(
            "خطا در ارتباط با سرور"
        );


    }



    sendOtpBtn.disabled=false;


});












// ثبت نام

registerBtn.addEventListener(
"click",
async()=>{


    const phone =
    phoneInput.value.trim();


    const password =
    passwordInput.value;


    const otp =
    otpInput.value.trim();




    if(!phone || !password || !otp){


        showMessage(
            "اطلاعات را کامل کنید"
        );

        return;

    }




    registerBtn.disabled=true;



    try{



        // تایید OTP

        const verify =
        await apiCall(
            "verify-otp",
            {
                phone,
                code:otp,
                purpose:"register"
            }
        );



        if(!verify.success){


            showMessage(
                verify.error ||
                "کد تایید اشتباه است"
            );


            registerBtn.disabled=false;

            return;

        }





        // ساخت حساب

        const result =
        await apiCall(
            "register-user",
            {
                phone,
                password
            }
        );





        if(result.success){


            showMessage(
                "ثبت نام موفق بود",
                true
            );



            setTimeout(()=>{


                window.location.href =
                "login.html";


            },1000);



        }
        else{


            showMessage(
                result.error ||
                "خطا در ثبت نام"
            );


        }



    }
    catch(error){


        console.error(error);


        showMessage(
            "خطا در ارتباط با سرور"
        );


    }



    registerBtn.disabled=false;



});