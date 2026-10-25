# Project workflow

- Build this app locally on Noam's Mac, as explicitly requested by the user.
- Use Expo local compilation with Xcode/CocoaPods for iOS and Android SDK/Gradle for Android. Do not submit builds to hosted EAS Build or another cloud build service.
- The `ios`, `android`, device and release npm scripts are local build commands. `npm start` serves the development app over the local network.
- Downloading dependencies and using runtime APIs or push delivery services are separate from where compilation runs. The local-build preference does not prohibit those services.
- Keep README build instructions consistent with this workflow. Report missing prerequisites and actual verification status accurately.
- On a new machine, read HANDOFF.md before continuing. The source is portable; SDKs, simulator UDIDs, credentials and npm packages are machine-local. Preserve each child's permanent community_people identity. The roster and aliyah backend are documented in server/API.md; new-member classification has a gabbai screen, while full roster/aliyah/seating administration UI and broader household/account linking remain future work.
