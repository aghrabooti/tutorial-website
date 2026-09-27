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







// شمارش معکوس روی دکمه‌ی ارسال کد (وقتی سرور می‌گوید «صبر کن»)

let cooldownTimer = null;

function startCooldown(seconds, reason) {

    clearInterval(cooldownTimer);

    let left = Math.max(1, Number(seconds) || 60);
    const original = sendOtpBtn.textContent;

    sendOtpBtn.disabled = true;

    const tick = () => {

        sendOtpBtn.textContent = `ارسال دوباره تا ${left} ثانیه`;

        if (left <= 0) {

            clearInterval(cooldownTimer);
            cooldownTimer = null;
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = original;

            showMessage(reason || "حالا می‌توانید دوباره کد بگیرید", true);

            return;
        }

        left--;
    };

    tick();
    cooldownTimer = setInterval(tick, 1000);
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



    clearInterval(cooldownTimer);
    cooldownTimer = null;
    sendOtpBtn.disabled = true;
    sendOtpBtn.textContent = "ارسال کد تایید";



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


            if(result.dev_mode || result.sms_configured === false){

                // پیامکی ارسال نشده — کد فقط در پاسخ API برگشته است
                showMessage(
                    "کد ساخته شد ولی پیامکی ارسال نشد (سامانه‌ی پیامک تنظیم نشده). " +
                    "کد در کنسول مرورگر (F12 → Console) نمایش داده شده است."
                );

            } else {

                showMessage(
                    "کد تایید پیامک شد",
                    true
                );

            }



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


            if(result.cooldown || result.retry_after){

                // سرور فاصله‌ی مجاز را اعلام کرده → شمارش معکوس نشان می‌دهیم
                startCooldown(
                    result.retry_after || 60,
                    "حالا می‌توانید دوباره کد بگیرید"
                );

            }


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



    if(!cooldownTimer){

        sendOtpBtn.disabled=false;

    }

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




        const verify =
        await apiCall(
            "otp-verify",
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
                "/login";


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