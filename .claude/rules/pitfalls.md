# Bài học đã trả giá

Mỗi dòng là một lỗi đã xảy ra trong dự án và cách tránh. Gặp lỗi quy trình mới → thêm 1 dòng, cùng commit sửa lỗi.

## Quy trình

- Bắt đầu session: `git fetch origin main`, đọc `docs/PLAN.md` và `docs/HANDOFF.md`. Đã có 2 session làm trùng một vòng.
- Chỉ làm việc thuộc mốc đang mở của `docs/PLAN.md`. Khoảng 60% token đã dùng cho đánh bóng giao diện khi chưa có người dùng.
- Vòng `developer` dự kiến > 400k token hoặc > 12 AC: chia nhỏ trước khi giao. Một vòng 1,09M token đã bị dừng giữa chừng vì hạn mức.
- Subagent commit + push từng phần đã pass. Bị dừng giữa chừng: chờ hạn mức rồi `SendMessage` cho chính agent đó, không mở agent mới.
- Số đếm, số đo ghi vào tài liệu phải lấy từ lệnh vừa chạy. Đã ghi sai "37 hàm" (thật là 41).
- Đổi code thì đổi README/spec/HANDOFF trong cùng commit. README từng mô tả sai hiện trạng nhiều tuần.

## Giao diện

- Dựng mẫu Artifact, Harold duyệt, rồi mới code. Yêu cầu UI chốt dần qua ảnh chụp đã gây 4 vòng sửa.
- Session chính tự soi từng ảnh ở 1280, 1024, 390 trước khi gửi. Harold không phải người tìm lỗi bố cục.
- E2E chỉ chạy sau khi `pnpm --filter @hrflow/web build:e2e` exit 0. Đã từng build lỗi âm thầm và test chạy trên bản cũ.
- Test hoặc ảnh so pixel chập chờn: không nới ngưỡng, không skip; lặp lại lần 2 thì điều tra nguyên nhân.
- Không dựa vào thứ tự class Tailwind để ghi đè (`pb-0` đã thua `pb-12`).
- Không dùng control mặc định của trình duyệt, kể cả `<input type="file">` hiện chữ.
- Đầu mỗi vòng báo ngân sách JS còn lại; code mới đặt trong chunk lười.
- Lỗi và nhãn hiển thị cho người dùng không chứa key nội bộ hay đường dẫn cấu hình.

## Supabase

- Qua MCP, SQL chứa `drop` hoặc `delete` treo 60 giây rồi bị hủy. Migration không dùng hai từ đó; phần bắt buộc thì gửi Harold dán vào SQL Editor.
- Bảng mới: `revoke all … from public, anon, authenticated` trước khi `grant`. Postgres local không có quyền mặc định của Supabase nên test local không bắt được.
- RLS/RPC mới phải chạy bài test (tự rollback) trên DB thật trước khi lên `main`, rồi chạy security advisor.
- Repo public: không đưa bản dump, secret hay dữ liệu chưa mã hóa vào artifact, log của Actions hoặc commit.

## Engine và dữ liệu

- Code nhận file từ ngoài (giải nén, parser): giao `verifier` fuzz ngay vòng đầu. Lỗ hổng zip bomb đã mất 5 vòng sửa.
- Ngữ nghĩa có ở cả TypeScript và SQL (chuẩn hóa khóa, decimal, ô trống): sửa một bên phải sửa bên kia và có test tương đương.
- Harold dùng file thật trên máy mình khi thử. Nội dung đó không được vào chat, ảnh chụp, fixture hay commit; thấy dữ liệu trông như thật thì nhắc Harold và không chép lại.
