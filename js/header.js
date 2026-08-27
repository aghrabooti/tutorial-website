// لودر هدر مشترک — یک نسخه‌ی واحد و قطعی
// هدر را از مسیر مطلق می‌خواهد تا روی هر URL‌ای (تمیز یا فایل مستقیم) کار کند.

async function loadHeader(){

    const container = document.getElementById("header");

    if(!container)
        return;

    try{

        const response = await fetch("/components/header.html");

        if(!response.ok){
            console.error("Header failed:", response.status);
            return;
        }

        container.innerHTML = await response.text();

        updateActivePage();

        // این دو تابع اگر در صفحه تعریف شده باشند صدا زده می‌شوند
        if(typeof updateAuthButton === "function")
            updateAuthButton();

        if(typeof updateCartBadge === "function")
            updateCartBadge();

    }
    catch(error){
        console.error("Header load error:", error);
    }

}

function updateActivePage(){

    const page = document.body.id;

    document
    .querySelectorAll(".nav-link")
    .forEach(link => {

        if(link.dataset.page === page){
            link.classList.remove("text-gray-600");
            link.classList.add("text-indigo-600", "font-bold");
        }

    });

}

document.addEventListener("DOMContentLoaded", loadHeader);
