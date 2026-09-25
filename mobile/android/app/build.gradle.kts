import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Kunci rilis tetap (android/key.properties + app/upload-keystore.jks, di luar
// git). Android hanya memasang pembaruan di atas aplikasi lama bila kuncinya
// sama; kunci debug dibuat ulang di setiap container Docker, jadi tidak bisa
// dipakai untuk rilis. Tanpa berkas ini build rilis jatuh ke kunci debug
// (untuk `flutter run --release`), dan rilis.sh menolak membangun.
val kunciRilis = rootProject.file("key.properties").takeIf { it.exists() }?.let { berkas ->
    Properties().apply { berkas.inputStream().use { load(it) } }
}

android {
    namespace = "id.nusantara.hrd.hrd_nusantara"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // flutter_local_notifications memakai java.time; butuh desugaring.
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "id.nusantara.hrd.hrd_nusantara"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (kunciRilis != null) {
            create("release") {
                keyAlias = kunciRilis.getProperty("keyAlias")
                keyPassword = kunciRilis.getProperty("keyPassword")
                storeFile = file(kunciRilis.getProperty("storeFile"))
                storePassword = kunciRilis.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (kunciRilis != null) "release" else "debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
