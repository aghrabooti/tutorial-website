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
        setupMobileMenu(container);

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


// ── منوی موبایل: باز/بسته، آیکون، بستن با Escape / کلیک بیرون / تغییر سایز ──
function setupMobileMenu(container){

    const menuBtn    = container.querySelector("#menu-btn");
    const mobileMenu = container.querySelector("#mobile-menu");

    if(!menuBtn || !mobileMenu)
        return;

    const iconOpen  = menuBtn.querySelector('[data-icon="open"]');
    const iconClose = menuBtn.querySelector('[data-icon="close"]');

    function setOpen(open){

        mobileMenu.hidden = !open;
        menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
        menuBtn.setAttribute("aria-label", open ? "بستن منو" : "باز کردن منو");

        if(iconOpen)  iconOpen.classList.toggle("hidden", open);
        if(iconClose) iconClose.classList.toggle("hidden", !open);

        // قفل اسکرول پس‌زمینه وقتی منو باز است (فقط موبایل)
        document.documentElement.classList.toggle("menu-open", open);
    }

    const isOpen = () => !mobileMenu.hidden;

    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        setOpen(!isOpen());
    });

    // کلیک روی لینک‌های منو → بستن
    mobileMenu.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => setOpen(false));
    });

    // کلیک بیرون از هدر → بستن
    document.addEventListener("click", (e) => {
        if(isOpen() && !container.contains(e.target))
            setOpen(false);
    });

    // Escape → بستن
    document.addEventListener("keydown", (e) => {
        if(e.key === "Escape" && isOpen())
            setOpen(false);
    });

    // وقتی به دسکتاپ برمی‌گردیم منو بسته شود
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (ev) => { if(ev.matches && isOpen()) setOpen(false); };
    if(mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
}


function updateActivePage(){

    const page = document.body.id;

    document
    .querySelectorAll(".nav-link")
    .forEach(link => {

        if(link.dataset.page === page){
            link.classList.remove("text-gray-600");
            link.classList.add("text-indigo-600", "font-bold", "bg-indigo-50");
        }

    });

}

document.addEventListener("DOMContentLoaded", loadHeader);
