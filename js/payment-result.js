// صفحه بازگشت از درگاه زرین‌پال
// زرین‌پال کاربر را به این آدرس برمی‌گرداند:
//   /payment-result?Authority=A000...&Status=OK        → باید verify شود
//   /payment-result?Authority=A000...&Status=NOK       → لغو/ناموفق

const params = new URLSearchParams(window.location.search);
const authority = params.get("Authority");
const status = params.get("Status");

const states = {
    processing: document.getElementById("state-processing"),
    success: document.getElementById("state-success"),
    failed: document.getElementById("state-failed"),
    canceled: document.getElementById("state-canceled"),
};

function showState(name) {
    Object.keys(states).forEach((key) => {
        states[key].classList.toggle("hidden", key !== name);
    });
}

function showFailed(message) {
    document.getElementById("error-text").textContent =
        message || "خطایی در تأیید پرداخت رخ داد.";
    showState("failed");
}

document.addEventListener("DOMContentLoaded", async () => {

    if (!authority) {
        showFailed("شناسه تراکنش در آدرس صفحه وجود ندارد.");
        return;
    }

    // طبق مستندات: وریفای فقط زمانی معنا دارد که Status برابر OK باشد
    if (status === "NOK") {
        showState("canceled");
        return;
    }

    try {
        const result = await apiCall("payment-verify", { authority });

        if (result.success) {
            // اگر سفارش شامل محصول فیزیکی (کتاب / جزوه) است،
            // کاربر را به فرم ثبت آدرس ارسال می‌بریم
            if (result.needs_shipping && result.order_id) {
                window.location.replace(
                    "/shipping-address?order=" +
                    encodeURIComponent(result.order_id)
                );
                return;
            }

            document.getElementById("ref-id").textContent =
                result.ref_id ?? "—";
            showState("success");
        } else {
            showFailed(result.error);
        }

    } catch (error) {
        console.error(error);
        showFailed("خطا در ارتباط با سرور. لطفاً چند لحظه دیگر دوباره تلاش کنید.");
    }
});
