const token =
localStorage.getItem("session_token");


const container =
document.getElementById("courses-list");


let currentCourses = [];



async function loadCourses(){


if(!token){

window.location.href="/login";
return;

}


try{


const result =
await apiCall(
"admin-get-courses",
{
token
}
);



if(!result.success){

container.innerHTML =
`
<div class="text-red-500 font-bold">
${result.error}
</div>
`;

return;

}



currentCourses = result.courses;

renderCourses(currentCourses);



}
catch(error){

console.error(error);


container.innerHTML =
`
<div class="text-red-500">
خطا در دریافت محتوا
</div>
`;


}


}





function renderCourses(courses){


if(courses.length===0){

container.innerHTML =
`
<div class="bg-white p-8 rounded-xl">

محتوایی وجود ندارد

</div>
`;

return;

}



container.innerHTML="";



courses.forEach(course=>{


let typeText =
course.type==="course"
?
"دوره"
:
course.type==="lecture"
?
"جزوه"
:
"کتاب";



container.innerHTML +=
`

<div class="bg-white border rounded-2xl p-5 flex gap-5">


<img
src="${course.image_url || ''}"
class="w-32 h-20 rounded-xl object-cover">



<div class="flex-1">


<h3 class="font-black text-lg">

${course.title}

</h3>



<span class="inline-block mt-2 bg-gray-100 px-3 py-1 rounded-full text-xs">

${typeText}

</span>



<p class="text-gray-500 text-sm mt-3">

${course.description || ""}

</p>


<div class="mt-3 text-indigo-600 font-bold">

${course.price ? 
Number(course.price).toLocaleString("fa-IR")+" تومان"
:
"رایگان"}

</div>



</div>



<div class="flex flex-col gap-2 h-fit">

<button

onclick="editCourse('${course.id}')"

class="
bg-indigo-600
text-white
px-5
py-2
rounded-xl">

ویرایش

</button>

<button

onclick="openSessionsModal('${course.id}')"

class="
bg-gray-800
text-white
px-5
py-2
rounded-xl">

جلسات 🎬

</button>

</div>


</div>

`;

});


}






function createCourse(){


clearForm();


openEditModal();


}





function clearForm(){


document.getElementById("edit-course-id").value="";


document.getElementById("edit-title").value="";

document.getElementById("edit-description").value="";

document.getElementById("edit-price").value="";

document.getElementById("edit-discount").value="";

document.getElementById("edit-grade").value="";

document.getElementById("edit-major").value="";

document.getElementById("edit-category").value="";

document.getElementById("edit-type").value="course";

document.getElementById("edit-image").value="";


}





function editCourse(id){


const course =
currentCourses.find(
c=>c.id===id
);



if(!course)
return;



document.getElementById("edit-course-id").value =
course.id;


document.getElementById("edit-title").value =
course.title ?? "";


document.getElementById("edit-description").value =
course.description ?? "";


document.getElementById("edit-price").value =
course.price ?? "";


document.getElementById("edit-discount").value =
course.discount_price ?? "";


document.getElementById("edit-grade").value =
course.grade ?? "";


document.getElementById("edit-major").value =
course.major ?? "";


document.getElementById("edit-category").value =
course.category ?? "";


document.getElementById("edit-type").value =
course.type ?? "course";


document.getElementById("edit-image").value =
course.image_url ?? "";


openEditModal();


}








async function saveCourse(){


const courseId =
document.getElementById("edit-course-id").value;



const data = {


token,


title:
document.getElementById("edit-title").value,


description:
document.getElementById("edit-description").value || null,


price:
document.getElementById("edit-price").value || null,


discount_price:
document.getElementById("edit-discount").value || null,


grade:
document.getElementById("edit-grade").value || null,


major:
document.getElementById("edit-major").value || null,


category:
document.getElementById("edit-category").value || null,


type:
document.getElementById("edit-type").value,


image_url:
document.getElementById("edit-image").value || null


};





let result;



if(courseId){


result =
await apiCall(
"admin-update-course",
{

...data,

course_id:courseId

}
);



}
else{


result =
await apiCall(
"admin-create-course",
data
);



}




if(!result.success){

alert(result.error);

return;

}



closeEditModal();


await loadCourses();


}






function closeEditModal(){

document
.getElementById("edit-modal")
.classList.add("hidden");

}



function openEditModal(){

document
.getElementById("edit-modal")
.classList.remove("hidden");

}





function logout(){


localStorage.removeItem("session_token");

localStorage.removeItem("user");


window.location.href="/login";


}



loadCourses();
const gradeSelect =
document.getElementById("edit-grade");


const majorSelect =
document.getElementById("edit-major");



gradeSelect.addEventListener(
"change",
()=>{


    if(gradeSelect.value==="9"){


        majorSelect.value="";

        majorSelect.disabled=true;

        majorSelect.classList.add(
            "bg-gray-100"
        );


    }
    else{


        majorSelect.disabled=false;

        majorSelect.classList.remove(
            "bg-gray-100"
        );


    }


});

/* ══════════════════════════════════════════════════════════════════
   امکانات جدید: جستجو، آپلود عکس/PDF، مدیریت جلسات
   ══════════════════════════════════════════════════════════════════ */


// ── جستجو در فهرست دوره‌ها ──
const courseSearchInput =
document.getElementById("course-search");

if (courseSearchInput) {

    courseSearchInput.addEventListener("input", () => {

        const q = courseSearchInput.value.trim();

        if (!q) {
            renderCourses(currentCourses);
            return;
        }

        const filtered = currentCourses.filter((c) =>
            (c.title ?? "").includes(q) ||
            (c.category ?? "").includes(q) ||
            (c.description ?? "").includes(q)
        );

        renderCourses(filtered);
    });
}


// ── آپلود عکس و PDF در مودال ویرایش دوره ──

function pickFile(accept) {
    return new Promise((resolve) => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = accept;
        inp.onchange = () => resolve(inp.files[0] ?? null);
        inp.click();
    });
}

async function putToSignedUrl(url, file) {
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
    });

    if (!res.ok) {
        console.error(await res.text().catch(() => ""));
        throw new Error("upload failed");
    }
}

function setUploadStatus(text, state) {
    const el = document.getElementById("upload-status");
    if (!el) return;

    el.textContent = text;
    el.className =
        "mt-2 text-xs " +
        (state === true
            ? "text-green-600"
            : state === false
              ? "text-red-500"
              : "text-gray-500");
}

window.uploadCourseImage = async () => {

    if (!token) return;

    try {

        const file = await pickFile("image/*");
        if (!file) return;

        setUploadStatus("در حال گرفتن مجوز آپلود...", null);

        const res = await apiCall("admin-upload-url", {
            token,
            kind: "image",
            filename: file.name,
        });

        if (!res.success) {
            setUploadStatus(res.error || "خطا در مجوز آپلود", false);
            return;
        }

        setUploadStatus("در حال ارسال عکس...", null);
        await putToSignedUrl(res.upload_url, file);

        document.getElementById("edit-image").value = res.public_url;

        setUploadStatus("عکس آپلود شد ✓ — لینک در فیلد تصویر قرار گرفت", true);

    } catch (e) {
        console.error(e);
        setUploadStatus("خطا در آپلود", false);
    }
};

window.uploadCoursePdf = async () => {

    if (!token) return;

    const courseId = document.getElementById("edit-course-id").value;

    if (!courseId) {
        setUploadStatus(
            "ابتدا دوره را ذخیره کنید، سپس فایل را آپلود کنید",
            false
        );
        return;
    }

    try {

        const file = await pickFile("application/pdf,.pdf");
        if (!file) return;

        setUploadStatus("در حال گرفتن مجوز آپلود...", null);

        const res = await apiCall("admin-upload-url", {
            token,
            kind: "pdf",
            course_id: courseId,
        });

        if (!res.success) {
            setUploadStatus(res.error || "خطا در مجوز آپلود", false);
            return;
        }

        setUploadStatus("در حال ارسال فایل...", null);
        await putToSignedUrl(res.upload_url, file);

        setUploadStatus(
            "فایل آپلود شد ✓ — خریداران از صفحه‌ی محصول دانلود می‌کنند",
            true
        );

    } catch (e) {
        console.error(e);
        setUploadStatus("خطا در آپلود", false);
    }
};

// دکمه‌ی آپلود PDF برای همه‌ی انواع محصول فعال است
// (دوره‌ها هم می‌توانند فایل جزوه داشته باشند)
function updateUploadVisibility() {
    const btn = document.getElementById("pdf-upload-btn");

    if (btn) {
        btn.classList.remove("hidden");
    }

    setUploadStatus("", null);
}

document
    .getElementById("edit-type")
    .addEventListener("change", updateUploadVisibility);

// هنگام بازشدن مودال هم وضعیت را درست کنیم
const _originalOpenEditModal = openEditModal;

window.openEditModal = function () {
    _originalOpenEditModal();
    updateUploadVisibility();
};


// ── مدیریت جلسات ──

window.sessionsCache = [];

// لینک آپارات: کد امبد کامل iframe، لینک صفحه‌ی ویدیو یا لینک امبد — هر سه
// به لینک امبد استاندارد تبدیل می‌شوند. لینک‌های غیر آپاراتی دست‌نخورده می‌مانند.
function normalizeAparatVideoUrl(raw) {
    if (!raw) return raw;
    let s = String(raw).trim();

    const srcMatch = s.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) s = srcMatch[1];

    if (!/aparat\.com/i.test(s)) return s;

    const hashMatch =
        s.match(/videohash=([A-Za-z0-9]+)/i) ||
        s.match(/aparat\.com\/(?:v|video)\/([A-Za-z0-9]+)/i);

    if (!hashMatch) return s;

    return (
        "https://www.aparat.com/video/video/embed?hidetitle=true&recom=self&videohash=" +
        hashMatch[1]
    );
}
let sessionsCourseId = null;

function toLocalInputValue(iso) {
    if (!iso) return "";

    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";

    const pad = (n) => String(n).padStart(2, "0");

    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
}

const escAttr = (s) => String(s ?? "").replace(/"/g, "&quot;");

function renderSessions() {

    const list = document.getElementById("sessions-list");

    if (window.sessionsCache.length === 0) {

        list.innerHTML = `
        <div class="bg-gray-50 rounded-xl p-5 text-center text-gray-400 text-sm">
        جلسه‌ای وجود ندارد — با «افزودن جلسه» شروع کنید
        </div>`;

        return;
    }

    list.innerHTML = window.sessionsCache.map((s, i) => `

    <div class="bg-gray-50 border rounded-2xl p-4 space-y-3">

        <div class="flex gap-3 flex-wrap items-center">

            <input type="number" min="1"
                value="${s.session_number ?? ""}"
                placeholder="شماره"
                title="شماره‌ی جلسه"
                onchange="window.sessionsCache[${i}].session_number=this.value"
                class="w-20 border rounded-xl p-2 text-sm">

            <input type="text"
                value="${escAttr(s.title)}"
                placeholder="عنوان جلسه"
                style="flex:1; min-width:150px;"
                onchange="window.sessionsCache[${i}].title=this.value"
                class="border rounded-xl p-2 text-sm">

            <button
                onclick="deleteSessionRow(${i})"
                title="حذف جلسه"
                class="text-red-500 px-3 font-black">✕</button>

        </div>

        <input type="text" dir="ltr"
            value="${escAttr(s.video_url)}"
            placeholder="لینک یا کد امبد آپارات — خودکار تبدیل به پلیر می‌شود"
            onchange="window.sessionsCache[${i}].video_url=this.value"
            class="w-full border rounded-xl p-2 text-sm text-left">

        <label class="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox"
                ${s.is_online ? "checked" : ""}
                onchange="window.sessionsCache[${i}].is_online=this.checked; renderSessions()">
            جلسه‌ی آنلاین (کلاس زنده) 🎥
        </label>

        <div class="${s.is_online ? "" : "hidden"} space-y-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3">

            <input type="text" dir="ltr"
                value="${escAttr(s.online_url)}"
                placeholder="https:// — لینک ورود به کلاس (اسکای‌روم / گوگل‌میت / ...)"
                onchange="window.sessionsCache[${i}].online_url=this.value"
                class="w-full border rounded-xl p-2 text-sm text-left">

            <label class="block text-xs font-bold text-gray-600">
                ساعت شروع کلاس — لینک از ۵ دقیقه قبل فعال می‌شود
            </label>

            <input type="datetime-local" dir="ltr"
                value="${toLocalInputValue(s.scheduled_at)}"
                onchange="window.sessionsCache[${i}].scheduled_at=this.value?new Date(this.value).toISOString():null"
                class="border rounded-xl p-2 text-sm">

        </div>

    </div>

    `).join("");
}

window.openSessionsModal = async (courseId) => {

    const course = currentCourses.find((c) => c.id === courseId);

    sessionsCourseId = courseId;
    window.sessionsCache = [];

    document.getElementById("sessions-course-title").textContent =
        course?.title ?? "";

    const status = document.getElementById("sessions-status");
    status.textContent = "";

    document.getElementById("sessions-modal").classList.remove("hidden");

    const list = document.getElementById("sessions-list");
    list.innerHTML = `
    <div class="text-gray-400 text-sm p-4">در حال بارگذاری جلسات...</div>`;

    try {

        const res = await apiCall("admin-get-sessions", {
            token,
            course_id: courseId,
        });

        if (!res.success) {
            list.innerHTML = `
            <div class="text-red-500 text-sm p-4">${res.error}</div>`;
            return;
        }

        window.sessionsCache = res.sessions;
        renderSessions();

    } catch (e) {
        console.error(e);
        list.innerHTML = `
        <div class="text-red-500 text-sm p-4">خطا در ارتباط با سرور</div>`;
    }
};

window.closeSessionsModal = () => {
    document.getElementById("sessions-modal").classList.add("hidden");
    sessionsCourseId = null;
    window.sessionsCache = [];
};

window.addSessionRow = () => {

    const next =
        window.sessionsCache.reduce(
            (m, s) => Math.max(m, Number(s.session_number) || 0),
            0
        ) + 1;

    window.sessionsCache.push({
        session_number: next,
        title: "",
        video_url: "",
        is_online: false,
        online_url: "",
        scheduled_at: null,
    });

    renderSessions();
};

window.deleteSessionRow = (i) => {
    window.sessionsCache.splice(i, 1);
    renderSessions();
};

window.saveSessions = async () => {

    const status = document.getElementById("sessions-status");

    if (!sessionsCourseId) return;

    for (const s of window.sessionsCache) {

        s.video_url = normalizeAparatVideoUrl(s.video_url);

        if (!s.title || !s.session_number) {
            status.className = "text-sm text-red-500";
            status.textContent =
                "همه‌ی جلسات باید شماره و عنوان داشته باشند";
            return;
        }

        if (s.is_online && !s.online_url) {
            status.className = "text-sm text-red-500";
            status.textContent =
                "برای جلسه‌ی آنلاین، لینک ورود را هم وارد کنید";
            return;
        }
    }

    status.className = "text-sm text-gray-500";
    status.textContent = "در حال ذخیره...";

    try {

        const res = await apiCall("admin-save-sessions", {
            token,
            course_id: sessionsCourseId,
            sessions: window.sessionsCache,
        });

        if (res.success) {

            status.className = "text-sm text-green-600";
            status.textContent = "ذخیره شد ✓";

            const res2 = await apiCall("admin-get-sessions", {
                token,
                course_id: sessionsCourseId,
            });

            if (res2.success) {
                window.sessionsCache = res2.sessions;
            }

            renderSessions();

        } else {
            status.className = "text-sm text-red-500";
            status.textContent = res.error || "خطا در ذخیره";
        }

    } catch (e) {
        console.error(e);
        status.className = "text-sm text-red-500";
        status.textContent = "خطا در ارتباط با سرور";
    }
};
