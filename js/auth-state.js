// وضعیت ورود کاربر — مشترک بین همه‌ی صفحات
// بعد از اینکه header.js هدر را تزریق کرد، این تابع را صدا می‌زند.
// نکته: بک‌اند field موفقیت را گاهی success و گاهی valid می‌فرستد؛
// هر دو را قبول می‌کنیم.

async function updateAuthButton(){

    const authBtn = document.getElementById("auth-btn");

    if(!authBtn)
        return;

    const token = localStorage.getItem("session_token");

    if(!token){
        authBtn.textContent = "ورود / ثبت‌نام";
        authBtn.href = "/login";
        return;
    }

    try{

        const result = await apiCall("check-session", { token });

        if(result && (result.valid === true || result.success === true)){
            authBtn.textContent = "پنل کاربری";
            authBtn.href = "/dashboard";
        }
        else{
            localStorage.removeItem("session_token");
            authBtn.textContent = "ورود / ثبت‌نام";
            authBtn.href = "/login";
        }

    }
    catch(error){
        console.error("auth state:", error);
    }

}
