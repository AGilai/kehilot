"""Read-only local build prerequisites; no installs, sign-ins or cloud builds."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        output = (result.stdout + result.stderr).strip()
        return result.returncode == 0, output.splitlines()[0] if output else 'no output'
    except (OSError, subprocess.TimeoutExpired):
        return False, 'not available'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['ios', 'android', 'all'], default='all')
    args = parser.parse_args()
    missing = []

    def check(label, ok, detail):
        print(f'{"OK     " if ok else "MISSING"} {label}: {detail}')
        if not ok:
            missing.append(label)

    node_ok, node_version = command(['node', '--version'])
    try:
        node_ok = node_ok and int(node_version.lstrip('v').split('.')[0]) >= 24
    except ValueError:
        node_ok = False
    check('Node.js 24+', node_ok, node_version)
    npm_ok, npm_version = command(['npm', '--version'])
    check('npm', npm_ok, npm_version)
    installed = all((ROOT / 'node_modules' / package / 'package.json').is_file() for package in ['expo', 'react-native', 'typescript'])
    check('Project packages', installed, 'installed' if installed else 'run npm install when registry access is available')

    if args.platform in ('ios', 'all'):
        xcode_ok, xcode_version = command(['xcodebuild', '-version'])
        check('Xcode', xcode_ok, xcode_version)
        sdk_ok, sdk_path = command(['xcrun', '--sdk', 'iphoneos', '--show-sdk-path'])
        check('iOS SDK', sdk_ok, sdk_path)
        pod_ok, pod_version = command(['pod', '--version']) if shutil.which('pod') else (False, 'install CocoaPods locally')
        check('CocoaPods', pod_ok, pod_version)

    if args.platform in ('android', 'all'):
        java_ok, java_version = command(['java', '-version'])
        check('Java', java_ok, java_version)
        sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or (Path.home() / 'Library' / 'Android' / 'sdk')).expanduser()
        check('Android SDK', sdk.is_dir(), str(sdk))
        check('Android platform tools', (sdk / 'platform-tools' / 'adb').is_file(), 'install Android SDK Platform-Tools using Android Studio')
        check('Android platform', any((sdk / 'platforms').glob('android-*')), 'install the platform required by the generated Gradle project')
        check('Android build tools', any((sdk / 'build-tools').glob('*')), 'install Android SDK Build-Tools using Android Studio')

    print()
    if missing:
        print(f'{len(missing)} prerequisite(s) missing. No files, credentials or system settings were changed.')
        return 1
    print('Prerequisites found. Native compilation, simulator runtime availability and device signing still need verification.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
