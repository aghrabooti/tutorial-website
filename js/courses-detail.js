const courseId =
new URLSearchParams(
    window.location.search
).get("id");




// دانلود فایل PDF جزوه/کتاب — فقط برای خریداران (لینک موقعت امضاشده)
window.downloadCourseFile = async () => {

    const btn =
    document.getElementById(
        "download-file-btn"
    );


    const token =
    localStorage.getItem(
        "session_token"
    );


    if(!token){

        window.location.href = "/login";

        return;

    }


    if(btn){

        btn.disabled = true;

        btn.innerText =
        "در حال آماده‌سازی لینک...";

    }


    try{

        const result =
        await apiCall(
            "get-course-file",
            {
                token,
                course_id:courseId
            }
        );


        if(result.success && result.url){

            window.open(
                result.url,
                "_blank"
            );

        }else{

            alert(
                result.error ||
                "خطا در دریافت فایل"
            );

        }

    }
    catch(error){

        console.error(error);

        alert("خطا در ارتباط با سرور");

    }
    finally{

        if(btn){

            btn.disabled = false;

            btn.innerText = "دانلود فایل";

        }

    }

};



async function loadCourseDetail(){


    if(!courseId){

        showError("شناسه دوره ارسال نشده است");
        return;

    }



    try{


        const course =
        await getCourse(courseId);



        if(!course){

            showError("دوره پیدا نشد");
            return;

        }



        renderCourse(course);



        await checkUserAccess(course.id);



    }
    catch(error){

        console.error(error);

        showError("خطا در دریافت اطلاعات دوره");

    }


}







async function getCourse(id){


    const response =
    await apiCall(
        "get-course",
        {
            course_id:id
        }
    );



    if(!response.success)
        return null;



    return response.course;


}







function renderCourse(course){


    document.title =
    `${course.title} | آکادمی عزیزی`;



    document.getElementById(
        "course-title"
    ).textContent =
    course.title;



    document.getElementById(
        "description"
    ).textContent =
    course.description ||
    "توضیحی ثبت نشده است";



    document.getElementById(
        "price"
    ).textContent =
    course.price
    ?
    Number(course.price)
    .toLocaleString("fa-IR")
    +" تومان"
    :
    "رایگان";




    const badge =
    document.getElementById(
        "course-type-badge"
    );



    if(badge){

        badge.textContent =
        course.type==="course"
        ?
        "دوره آموزشی"
        :
        "فایل آموزشی";

    }





    const img =
    document.getElementById(
        "course-image"
    );



    const placeholder =
    document.getElementById(
        "course-image-placeholder"
    );



    if(course.image_url && img){


        img.src =
        course.image_url;


        img.classList.remove(
            "hidden"
        );


        if(placeholder){

            placeholder.classList.add(
                "hidden"
            );

        }

    }





    const buyBtn =
    document.getElementById(
        "buy-btn"
    );



    if(buyBtn){


        buyBtn.onclick = ()=>{

            addToCart(course.id);

        };


    }


}









async function checkUserAccess(courseId){


    const token =
    localStorage.getItem(
        "session_token"
    );



    if(!token)
        return;




    try{


        const result =
        await apiCall(
            "check-course-access",
            {
                token,
                course_id:courseId
            }
        );



        if(!result.success)
            return;



        if(result.purchased){


            hidePurchaseBox();



            await showPurchasedContent(
                result.course
            );


        }



    }
    catch(error){

        console.error(error);

    }


}









function hidePurchaseBox(){


    const price =
    document.getElementById(
        "price"
    );


    const buyBtn =
    document.getElementById(
        "buy-btn"
    );



    if(price){

        price.parentElement.remove();

    }



    if(buyBtn){

        buyBtn.remove();

    }


}









async function showPurchasedContent(course){

    const content =
    document.getElementById(
        "course-content"
    );


    if(!content)
        return;


    document
    .getElementById("purchase-view")
    ?.classList.add("hidden");


    document
    .getElementById("content-view")
    ?.classList.remove("hidden");



    if(course.type !== "course"){

        content.innerHTML = `

        <div class="bg-white border rounded-2xl p-6">

            <h3 class="text-xl font-black">
                فایل آموزشی
            </h3>

            <p class="mt-2 text-sm text-gray-500">
                فایل PDF این محصول مخصوص خریداران است.
            </p>

            <button
            id="download-file-btn"
            onclick="downloadCourseFile()"
            class="mt-5 bg-green-600 text-white px-6 py-2 rounded-xl hover:bg-green-700">

                دانلود فایل

            </button>

        </div>

        `;

        return;

    }



    const token =
    localStorage.getItem(
        "session_token"
    );


    const result =
    await apiCall(
        "get-course-sessions",
        {
            token,
            course_id:course.id
        }
    );



    if(!result.success){

        content.innerHTML =
        `
        <div class="text-red-500 font-bold">
        خطا در دریافت جلسات
        </div>
        `;

        return;

    }



    let sessionsHTML = "";



    result.sessions.forEach(
        session=>{


        let actionBlock = "";

        // دکمه‌ی ویدیو — برای هر جلسه‌ای که ویدیو دارد (آنلاین یا ضبط‌شده)
        const videoBtn = session.video_url
            ? `
            <button
            onclick="playVideo('${normalizeAparatVideoUrl(session.video_url)}')"
            class="mt-3 ml-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-indigo-700">

                ${session.is_online ? "مشاهده‌ی ضبط جلسه 🎬" : "مشاهده"}

            </button>`
            : "";

        if(session.is_online){

            const when =
            session.scheduled_at
            ?
            new Date(session.scheduled_at).toLocaleString(
                "fa-IR",
                { dateStyle:"medium", timeStyle:"short" }
            )
            :
            "به‌زودی اعلام می‌شود";

            if(session.online_available && session.online_url){

                actionBlock = `
            <p class="mt-2 text-xs text-gray-500">🕐 شروع کلاس: ${when}</p>

            <a href="${session.online_url}" target="_blank" rel="noopener"
            class="inline-block mt-3 ml-2 bg-green-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-green-700">

                ورود به کلاس آنلاین 🎥

            </a>` + videoBtn;

            }else{

                actionBlock = `
            <p class="mt-2 text-xs text-gray-500">🕐 شروع کلاس: ${when}</p>

            <button disabled
            class="mt-3 ml-2 bg-gray-300 text-gray-500 px-4 py-2 rounded-xl text-sm cursor-not-allowed">

                لینک ۵ دقیقه قبل از کلاس فعال می‌شود

            </button>` + videoBtn;

            }

        }else{


            actionBlock = videoBtn || `
            <button disabled
            class="mt-3 bg-gray-100 text-gray-400 px-4 py-2 rounded-xl text-sm cursor-not-allowed">

                به‌زودی

            </button>`;

        }


        sessionsHTML += `


        <div
        class="bg-gray-50 border rounded-xl p-4">


            <h4 class="font-bold text-gray-800">

                جلسه ${session.session_number}
                -
                ${session.title}

                ${session.is_online ? '<span class="bg-red-100 text-red-600 text-xs rounded-full px-2 py-1 mr-2">آنلاین</span>' : ""}

            </h4>


            ${actionBlock}


        </div>


        `;


    });



    content.innerHTML = `


    <div class="bg-white border rounded-2xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">


        <div>

            <h3 class="font-black">
                فایل جزوه / پیوست دوره
            </h3>

            <p class="text-xs text-gray-500 mt-1">
                در صورت بارگذاری توسط استاد، از اینجا دانلود کنید
            </p>

        </div>


        <button
        id="download-file-btn"
        onclick="downloadCourseFile()"
        class="bg-green-600 text-white px-6 py-2 rounded-xl hover:bg-green-700">

            دانلود فایل PDF

        </button>

    </div>



    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">


        <!-- Player -->

        <div 
        class="lg:col-span-2 bg-black rounded-3xl overflow-hidden aspect-video flex items-center justify-center">


            <div id="video-player"
            class="w-full h-full flex items-center justify-center text-white">


                یک جلسه را برای مشاهده انتخاب کنید


            </div>


        </div>




        <!-- Sessions -->


        <div class="space-y-4">


            <h3 class="text-xl font-black">

                جلسات دوره

            </h3>



            ${sessionsHTML}


        </div>


    </div>


    `;


}








document.addEventListener(
"DOMContentLoaded",
()=>{


    loadCourseDetail();


});

// لینک‌های آپارات (کد امبد کامل / لینک صفحه / لینک امبد) به لینک امبد
// استاندارد تبدیل می‌شوند؛ لینک‌های دیگر دست‌نخورده می‌مانند.
function normalizeAparatVideoUrl(raw) {
    if (!raw) return raw;
    let s = String(raw).trim();

    const srcMatch = s.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) s = srcMatch[1];

    if (!/aparat\.com/i.test(s)) return s;

    const hashMatch =
        s.match(/videohash=([A-Za-z0-9]+)/i) ||
        s.match(/\/videohash\/([A-Za-z0-9]+)/i) ||
        s.match(/aparat\.com\/v\/([A-Za-z0-9]+)/i);

    if (!hashMatch) return s;

    // قالب رسمی امبد آپارات (همان چیزی که خود آپارات صادر می‌کند)
    return (
        "https://www.aparat.com/video/video/embed/videohash/" +
        hashMatch[1] +
        "/vt/frame?recom=self"
    );
}

function playVideo(url){

    const content =
    document.getElementById(
        "course-content"
    );


    content.innerHTML = `

    <div class="bg-black rounded-2xl overflow-hidden aspect-video">

        <iframe

        src="${url}"

        class="w-full h-full"

        frameborder="0"

        allowfullscreen>

        </iframe>

    </div>

    <button
    onclick="location.reload()"
    class="mt-4 bg-gray-200 px-4 py-2 rounded-xl">

        بازگشت به جلسات

    </button>

    `;

}

async function addToCart(courseId){

    const token =
    localStorage.getItem("session_token");

    if(!token){

        window.location.href = "/login";
        return;

    }

    try{

        const result =
        await apiCall(
            "add-to-cart",
            {
                token,
                course_id: courseId
            }
        );

        console.log(result);

        if(!result.success){

            alert(result.error || "خطا در افزودن به سبد خرید");
            return;

        }

        window.location.href = "/cart";

    }
    catch(error){

        console.error(error);

        alert("خطا در ارتباط با سرور");

    }

}