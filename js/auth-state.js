// وضعیت ورود کاربر — مشترک بین همه‌ی صفحات
// بعد از اینکه header.js هدر را تزریق کرد، این تابع را صدا می‌زند.
// نکته: بک‌اند field موفقیت را گاهی success و گاهی valid می‌فرستد؛
// هر دو را قبول می‌کنیم.
// دو دکمه داریم: #auth-btn (دسکتاپ/تبلت) و #auth-btn-mobile (داخل منوی موبایل)

function setAuthButtons(text, href){

    ["auth-btn", "auth-btn-mobile"].forEach((id) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.textContent = text;
        el.href = href;
    });

}

async function updateAuthButton(){

    if(!document.getElementById("auth-btn") && !document.getElementById("auth-btn-mobile"))
        return;

    const token = localStorage.getItem("session_token");

    if(!token){
        setAuthButtons("ورود / ثبت‌نام", "/login");
        return;
    }

    try{

        const result = await apiCall("check-session", { token });

        if(result && (result.valid === true || result.success === true)){
            setAuthButtons("پنل کاربری", "/dashboard");
        }
        else{
            localStorage.removeItem("session_token");
            setAuthButtons("ورود / ثبت‌نام", "/login");
        }

    }
    catch(error){
        console.error("auth state:", error);
    }

}
