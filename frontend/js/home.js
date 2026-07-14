async function updateAuthButton(){

    const authBtn =
    document.getElementById("auth-btn");


    if(!authBtn){
        return;
    }


    const token =
    localStorage.getItem("session_token");


    if(!token){

        authBtn.textContent =
        "ورود / ثبت‌نام";

        authBtn.href =
        "pages/login.html";

        return;

    }



    const result =
    await apiCall(
        "check-session",
        {
            token
        }
    );



    if(result.valid){

        authBtn.textContent =
        "پنل کاربری";

        authBtn.href =
        "pages/dashboard.html";

    }
    else{

        localStorage.removeItem(
            "session_token"
        );


        authBtn.textContent =
        "ورود / ثبت‌نام";


        authBtn.href =
        "pages/login.html";

    }

}





async function fetchCourses(){

    const container =
    document.getElementById(
        "courses-container"
    );


    if(!container){
        return;
    }


    const { data: courses, error } =
    await db
    .from("courses")
    .select("*");



    if(error || !courses || courses.length===0){

        container.innerHTML =
        `
        <div class="w-full text-center py-12 text-red-400 font-bold text-sm">
        خطا در بارگذاری اطلاعات یا لیست دوره‌ها خالی است.
        </div>
        `;

        return;

    }



    container.innerHTML="";



    courses.forEach(course=>{


        const card =
        document.createElement("div");


        card.className =
        "w-72 sm:w-80 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden flex-shrink-0 snap-start flex flex-col justify-between hover:shadow-md transition duration-300";



        const imgUrl =
        course.image_url ||
        "https://via.placeholder.com/400x225?text=No+Image";



        const formattedPrice =
        course.price
        ?
        Number(course.price).toLocaleString("fa-IR")+" تومان"
        :
        "رایگان";



        card.innerHTML =
        `
        <div class="relative aspect-video bg-gray-50 overflow-hidden">

            <img 
            src="${imgUrl}"
            class="w-full h-full object-cover">

        </div>


        <div class="p-5 space-y-4 flex-grow flex flex-col justify-between">

            <div>

                <h3 class="font-black text-sm sm:text-base text-gray-950">
                    ${course.title || "بدون نام"}
                </h3>


                <p class="text-xs text-gray-400">
                    ${course.description || ""}
                </p>

            </div>


            <div class="flex items-center justify-between">

                <span class="text-xs font-black text-indigo-600">
                    ${formattedPrice}
                </span>


                <a href="pages/courses-detail.html?id=${course.id}"
                class="bg-gray-950 text-white text-xs font-bold px-3 py-2 rounded-xl">

                مشاهده

                </a>

            </div>

        </div>
        `;


        container.appendChild(card);


    });


}





function initSlider(){

    const container =
    document.getElementById(
        "courses-container"
    );


    const prev =
    document.getElementById(
        "slide-prev-btn"
    );


    const next =
    document.getElementById(
        "slide-next-btn"
    );



    if(!container || !prev || !next){
        return;
    }



    prev.onclick=()=>{

        container.scrollLeft -=320;

    };



    next.onclick=()=>{

        container.scrollLeft +=320;

    };

}





function initMobileMenu(){

    const btn =
    document.getElementById(
        "menu-toggle-btn"
    );


    const menu =
    document.getElementById(
        "mobile-menu"
    );



    if(!btn || !menu){
        return;
    }



    btn.onclick=()=>{

        menu.classList.toggle("hidden");

    };

}





document.addEventListener(
"DOMContentLoaded",
()=>{

    updateAuthButton();

    fetchCourses();

    initSlider();

    initMobileMenu();

});