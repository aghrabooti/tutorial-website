/* ─────────────────────────────────────────────────────────────
   کاورهای محلی دوره‌ها
   اگر برای محصولی عکس (image_url) ثبت نشده باشد یا عکس معتبر نباشد،
   بر اساس نوع محصول و پایه تحصیلی یکی از کاورهای محلی جایگزین می‌شود.
───────────────────────────────────────────────────────────── */

const COURSE_COVERS = {
    grade9:  "/assets/images/courses/course-grade-9.jpg",
    grade10: "/assets/images/courses/course-grade-10.jpg",
    grade11: "/assets/images/courses/course-grade-11.jpg",
    grade12: "/assets/images/courses/course-grade-12.jpg",
    lecture: "/assets/images/courses/lecture-notes.jpg",
    book:    "/assets/images/courses/book-pack.jpg",
    default: "/assets/images/courses/cover-default.jpg"
};


const COURSE_COVER_PLACEHOLDER =
/placehold\.co|placeholder|via\.placehold|lorem[.-]?pics/i;



function courseCoverKeyByGrade(course){

    const grade =
    String(course.grade || "");

    const text =
    (course.title || "") +
    " " +
    (course.description || "");


    if(grade.includes("9")  || /نهم/.test(text))      return "grade9";
    if(grade.includes("10") || /دهم/.test(text))       return "grade10";
    if(grade.includes("11") || /یازدهم/.test(text))    return "grade11";
    if(grade.includes("12") || /دوازدهم/.test(text))   return "grade12";

    return null;

}



function resolveCourseImage(course){

    course = course || {};

    const url =
    (course.image_url || "").trim();


    // عکس ثبت‌شده در دیتابیس معتبر است مگر اینکه placeholder باشد
    if(url && !COURSE_COVER_PLACEHOLDER.test(url)){
        return url;
    }


    if(course.type === "lecture") return COURSE_COVERS.lecture;
    if(course.type === "book")    return COURSE_COVERS.book;


    const key =
    courseCoverKeyByGrade(course);

    return key
    ? COURSE_COVERS[key]
    : COURSE_COVERS.default;

}



// اگر عکس اصلی محصول لود نشد (لینک خراب)، کاور پیش‌فرض نمایش داده می‌شود
function courseCoverError(img){

    if(!img){
        return;
    }

    img.onerror = null;

    img.src =
    COURSE_COVERS.default;

}
