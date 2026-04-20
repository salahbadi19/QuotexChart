/**
 * QuotexChart Login Controller
 * يتعامل مع واجهة تسجيل الدخول ويربطها بـ engine.py عبر Eel
 */

// ✅ دالة تسجيل الدخول الرئيسية
async function login() {
    const emailEl = document.getElementById('email');
    const passEl = document.getElementById('password');
    const email = emailEl.value.trim();
    const password = passEl.value;

    if (!email || !password) {
        showError("Please enter your credentials");
        return;
    }

    // تعطيل الإدخال وإظهار التحميل
    emailEl.disabled = true;
    passEl.disabled = true;
    showSpinner();

    try {
        // استدعاء دالة البايثون عبر Eel
        await eel.login(email, password)();
    } catch (err) {
        hideSpinner();
        showError("Connection failed: " + (err.message || err));
        // إعادة التمكين عند الفشل
        emailEl.disabled = false;
        passEl.disabled = false;
    }
}

// ✅ تبديل إظهار/إخفاء كلمة المرور
function togglePassword() {
    const pass = document.getElementById('password');
    const eyeOpen = document.getElementById('eyeOpen');
    const eyeClosed = document.getElementById('eyeClosed');
    
    if (pass.type === "password") {
        pass.type = "text";
        eyeOpen.style.display = "none";
        eyeClosed.style.display = "block";
    } else {
        pass.type = "password";
        eyeOpen.style.display = "block";
        eyeClosed.style.display = "none";
    }
}

// ✅ دوال التحكم في واجهة المستخدم
function showSpinner() {
    document.getElementById('spinner').style.display = 'block';
    document.querySelector('.btn').disabled = true;
    document.getElementById('error').textContent = '';
}

function hideSpinner() {
    document.getElementById('spinner').style.display = 'none';
    document.querySelector('.btn').disabled = false;
    document.getElementById('email').disabled = false;
    document.getElementById('password').disabled = false;
}

function showError(msg) {
    document.getElementById('error').textContent = msg;
}

// ✅ دعم زر Enter
document.addEventListener('keydown', (e) => {
    if (e.key === "Enter" && !document.querySelector('.btn').disabled) {
        login();
    }
});

// ✅ استقبال الاستجابة من البايثون (Eel)
eel.expose(onLoginSuccess);
function onLoginSuccess() {
    hideSpinner();
    // التوجيه إلى واجهة التداول الرئيسية
    window.location.href = '../index.html';
}

eel.expose(onLoginError);
function onLoginError(reason) {
    hideSpinner();
    showError(reason || "Access denied");
    document.getElementById('email').focus();
}

// ✅ تحسين تجربة التحميل
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('email').focus();
    console.log('✅ Login UI initialized');
});
