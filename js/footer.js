// لودر فوتر مشترک — مثل هدر، یک نسخه‌ی واحد برای همه‌ی صفحات

async function loadFooter(){

    const container = document.getElementById("footer");

    if(!container)
        return;

    try{

        const response = await fetch("/components/footer.html");

        if(!response.ok){
            console.error("Footer failed:", response.status);
            return;
        }

        container.innerHTML = await response.text();

    }
    catch(error){
        console.error("Footer load error:", error);
    }

}

document.addEventListener("DOMContentLoaded", loadFooter);
