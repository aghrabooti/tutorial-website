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
        "group w-72 sm:w-80 bg-white rounded-3xl border border-gray-100 overflow-hidden flex-shrink-0 snap-start flex flex-col justify-between hover:-translate-y-1.5 hover:shadow-xl transition duration-300";



        const imgUrl =
        course.image_url ||
        "https://placehold.co/400x225?text=No+Image";



        const TYPE_FA = {
            course: "دوره",
            lecture: "جزوه",
            book: "کتاب"
        };

        const hasDiscount =
        course.discount_price &&
        Number(course.discount_price) > 0;

        const formattedPrice =
        hasDiscount
        ?
        `<span class="text-gray-300 line-through text-[11px] font-bold ml-1.5">${Number(course.price).toLocaleString("fa-IR")}</span><span class="text-indigo-600">${Number(course.discount_price).toLocaleString("fa-IR")} تومان</span>`
        :
        course.price
        ?
        `<span class="text-indigo-600">${Number(course.price).toLocaleString("fa-IR")} تومان</span>`
        :
        `<span class="text-emerald-600">رایگان</span>`;



        card.innerHTML =
        `
        <div class="relative aspect-video bg-gray-100 overflow-hidden">

            <img
            src="${imgUrl}"
            class="w-full h-full object-cover group-hover:scale-105 transition duration-500">

            <span class="absolute top-3 right-3 bg-white/85 backdrop-blur text-[10px] font-black text-gray-800 px-2.5 py-1 rounded-full">
                ${TYPE_FA[course.type] || "دوره"}
            </span>

        </div>


        <div class="p-5 space-y-4 flex-grow flex flex-col justify-between">

            <div>

                <h3 class="font-black text-sm sm:text-base text-gray-950">
                    ${course.title || "بدون نام"}
                </h3>


                <p class="text-xs text-gray-400 leading-relaxed mt-1.5" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
                    ${course.description || ""}
                </p>

            </div>


            <div class="flex items-center justify-between">

                <span class="text-xs font-black">
                    ${formattedPrice}
                </span>


                <a href="/courses-detail?id=${course.id}"
                class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition">

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